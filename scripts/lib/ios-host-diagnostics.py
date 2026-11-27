"""托管宿主只读取证：预先加载 libproc，避免故障发生后再启动 ps/Node。

仅观察本次命令树登记的 PID，不发送清理信号、不读取参数或替代执行回执。
主命令、阶段预算与进程清理仍由既有 CI 入口负责。
"""
import ctypes
import errno
from collections import Counter
import json
import math
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import time


class BsdInfo(ctypes.Structure):
    # Darwin proc_bsdshortinfo / PROC_PIDT_SHORTBSDINFO，来自 sys/proc_info.h。
    _fields_ = [(name, ctypes.c_uint32) for name in ("pid", "ppid", "pgid", "status")] + [
        ("comm", ctypes.c_char * 16)
    ] + [(name, ctypes.c_uint32) for name in (
        "flags", "uid", "gid", "ruid", "rgid", "svuid", "svgid", "reserved"
    )]


def observer():
    if sys.platform != "darwin":
        raise RuntimeError("libproc diagnostics requires Darwin")
    library = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    library.proc_pidinfo.restype = ctypes.c_int

    def read(pid):
        info = BsdInfo()
        count = library.proc_pidinfo(pid, 13, 0, ctypes.byref(info), ctypes.sizeof(info))
        if count != ctypes.sizeof(info):
            return {"pid": pid, "unavailable": ctypes.get_errno(), "bytes": count}
        return {**{key: getattr(info, key) for key in ("pid", "ppid", "pgid", "status", "flags", "uid", "ruid", "svuid")},
                "comm": info.comm.decode("utf-8", errors="replace")}
    def summary():
        # 只在明确请求的托管宿主取聚合数量；不输出其他任务的 PID、路径或参数。
        pids = (ctypes.c_int * 2048)()
        count = library.proc_listallpids(pids, ctypes.sizeof(pids))
        names, states = Counter(), Counter()
        for pid in pids[:max(0, min(count, len(pids)))]:
            info = read(pid)
            if "comm" in info:
                names[info["comm"]] += 1
                states[str(info["status"])] += 1
        return {"processCount": count, "truncated": count >= len(pids),
                "names": names.most_common(20), "states": states}
    library.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
    library.proc_listallpids.restype = ctypes.c_int
    read.summary = summary
    def process_tree():
        # Only PID/PPID/PGID are needed for cancellation. Avoid ps argument/symbol enumeration.
        capacity = max(256, library.proc_listallpids(None, 0) * 2 + 32)
        for _ in range(3):
            if capacity > 65536:
                raise RuntimeError("process tree exceeds bounded snapshot capacity")
            pids = (ctypes.c_int * capacity)()
            count = library.proc_listallpids(pids, ctypes.sizeof(pids))
            if count <= 0:
                raise RuntimeError("process tree enumeration failed")
            if count >= capacity:
                capacity *= 2
                continue
            rows = []
            for pid in pids[:count]:
                if pid <= 0:
                    continue
                ctypes.set_errno(0)
                info = read(pid)
                if "unavailable" in info:
                    if info["unavailable"] == errno.ESRCH:
                        continue  # A process that exited during the snapshot is no longer a child.
                    raise RuntimeError("process tree metadata unavailable")
                rows.append((info["pid"], info["ppid"], info["pgid"]))
            return rows
        raise RuntimeError("process tree changed beyond bounded enumeration")
    read.process_tree = process_tree
    return read


class StallSample:
    """只对本轮生命周期中停滞的自有进程取一次短栈；不改变主命令结果。"""
    def __init__(self, base, emit, factory=subprocess.Popen, clock=time.monotonic):
        self.base, self.emit, self.factory, self.clock = base, emit, factory, clock
        self.seen, self.active = set(), None

    def poll(self, pid, info, owned, started_at, now=time.time):
        self.reap()
        if (type(pid) is not int or pid <= 1 or info.get("pid") != pid or self.active or pid in self.seen or not owned or info.get("uid") != os.getuid()
                or info.get("comm") not in {"simctl", "node", "zsh", "xcrun"}
                or not isinstance(started_at, (int, float)) or not math.isfinite(started_at) or now()*1000-started_at < 20_000):
            return
        self.seen.add(pid)
        file = self.base / ("ios-stall-sample-" + str(pid) + ".txt")
        try:
            child = self.factory(["/usr/bin/sample", str(pid), "1", "10", "-file", str(file)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.active = (child, self.clock()+5)
            self.emit({"stallSample": "started", "target": info, "file": file.name})
        except OSError as error:
            self.emit({"stallSample": "unavailable", "error": str(error)})

    def reap(self, final=False):
        if self.active:
            child, end = self.active
            code = child.poll()
            if code is None and (final or self.clock() >= end):
                try:
                    child.kill()  # 只结束观察器亲自启动的采样进程，不向目标或进程组发信号。
                except ProcessLookupError:
                    pass
                except OSError as error:
                    self.emit({"stallSample": "cleanup-incomplete", "error": str(error)})
                    return
                try:
                    code = child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self.emit({"stallSample": "cleanup-incomplete"})
                    return
            if code is not None:
                self.emit({"stallSample": "completed", "exit": code})
                self.active = None


def run(args):
    if args == ["--process-tree"]:
        for row in observer().process_tree():
            print(*row)
        return 0
    host_summary = bool(args and args[0] == "--host-summary")
    if host_summary:
        if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "macOS":
            raise ValueError("host summary requires the hosted macOS job")
        args = args[1:]
    if not args or args[0] != "--" or len(args) < 2:
        raise ValueError("usage: ios-host-diagnostics.py -- command [args]")
    base = Path.cwd() / ".local/ios/tmp/ai-agent"
    base.mkdir(parents=True, exist_ok=True)
    file = base / ("ios-host-processes-" + str(os.getpid()) + ".jsonl")
    with file.open("x", encoding="utf-8") as output:
        os.chmod(file, 0o600)
        def emit(value):
            output.write(json.dumps({"at": time.time(), **value}) + "\n")
            output.flush()
        try:
            read = observer()
            emit({"scope": "diagnostic", "self": read(os.getpid())})
            if host_summary:
                tools = [shutil.which("xcrun"), "/usr/bin/xcrun",
                         os.environ.get("DEVELOPER_DIR", "") + "/usr/bin/simctl"]
                for tool in tools:
                    if tool and Path(tool).is_file():
                        with open(tool, "rb") as binary:
                            magic = binary.read(4).hex()
                        emit({"tool": tool, "realpath": str(Path(tool).resolve()), "magic": magic})
        except (OSError, RuntimeError) as error:
            read = None
            emit({"scope": "diagnostic", "unavailable": str(error)})
        sampler = StallSample(base, emit)
        started = time.time()
        # 不建立新进程组；原命令继承原工作流 stdout/stderr 和预算。
        child = subprocess.Popen(args[1:])
        def forward(number, _frame):
            if child.poll() is None:
                try:
                    child.send_signal(number)
                except ProcessLookupError:
                    pass
        signal.signal(signal.SIGTERM, forward)
        signal.signal(signal.SIGINT, forward)
        scopes, last = set(), {}
        next_summary = time.monotonic()
        def belongs(pid, state=None):
            visited = set()
            while pid > 1 and pid not in visited and pid != child.pid:
                visited.add(pid)
                current = state if state and state.get("pid") == pid else read(pid)
                pid = current.get("ppid", 0)
            return pid == child.pid
        while child.poll() is None:
            sampler.reap()
            if read:
                try:
                    for header in base.glob("ios-process-*/scope.json"):
                        if header.stat().st_mtime < started:
                            continue
                        value = json.loads(header.read_text())
                        if header.parent not in scopes:
                            if not belongs(value["owner"]):
                                continue
                            scopes.add(header.parent)
                        for member in header.parent.glob("*.json"):
                            if member.name == "scope.json":
                                continue
                            record = json.loads(member.read_text())
                            pid = record.get("pid")
                            if record.get("nonce") != value["nonce"] or not isinstance(pid, int) or pid <= 1:
                                continue
                            state = read(pid)
                            if not belongs(pid, state):
                                continue
                            if last.get(pid) != state:
                                emit({"member": record["id"], "process": state})
                                last[pid] = state
                    # 成功启动后不继续采样 App/容量或工具测试，避免取证常驻干扰验收。
                    for boot in base.glob("ios-debug-*/boot-readiness.json"):
                        if boot.stat().st_mtime >= started:
                            ready = json.loads(boot.read_text())
                            if ready.get("scope") == "environment" and ready.get("status") == "passed":
                                after = ready.get("afterBoot")
                                lifecycle = boot.parent / "boot-lifecycle.json"
                                life = json.loads(lifecycle.read_text()) if after and lifecycle.exists() else None
                                if life and life.get("status") == "running" and life.get("commands"):
                                    step = life["commands"][-1]
                                    pid = step.get("pid")
                                    if isinstance(pid, int) and pid > 1:
                                        state = read(pid)
                                        sampler.poll(pid, state, belongs(pid, state), step.get("startedAt"))
                                if not after or (life and life.get("status") == "passed"):
                                    sampler.reap(final=True)
                                    emit({"observationComplete": "boot-ready"})
                                    read = None
                                    break
                    if read and time.monotonic() >= next_summary:
                        emit({"load": os.getloadavg(), **(read.summary() if host_summary else {})})
                        next_summary = time.monotonic() + 10
                except (OSError, ValueError, KeyError) as error:
                    # 记录并发摘除/诊断失败；不改变主命令或伪造验证成功。
                    emit({"observationError": str(error)})
            time.sleep(0.5)
        sampler.reap(final=True)
        status = child.wait()
        emit({"commandExit": status})
        return status if status >= 0 else 128 - status


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
