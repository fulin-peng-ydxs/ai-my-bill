"""托管宿主只读取证：预先加载 libproc，避免故障发生后再启动 ps/Node。

仅观察本次命令树登记的 PID，不发送清理信号、不读取参数或替代执行回执。
主命令、阶段预算与进程清理仍由既有 CI 入口负责。
"""
import ctypes
from collections import Counter
import json
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
    return read


def run(args):
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
                    if time.monotonic() >= next_summary:
                        emit({"load": os.getloadavg(), **(read.summary() if host_summary else {})})
                        next_summary = time.monotonic() + 10
                except (OSError, ValueError, KeyError) as error:
                    # 记录并发摘除/诊断失败；不改变主命令或伪造验证成功。
                    emit({"observationError": str(error)})
            time.sleep(0.5)
        status = child.wait()
        emit({"commandExit": status})
        return status if status >= 0 else 128 - status


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
