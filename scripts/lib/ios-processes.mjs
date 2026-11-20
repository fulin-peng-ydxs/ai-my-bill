import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

/** 仅在取消时读取 PID/PPID/进程组，不读取命令参数；快照须早于 TERM 导致的父子关系消失。 */
function descendantGroups(pid, timeout) {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid='], {
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
    killSignal: 'SIGKILL'
  })
  if (result.error || result.status !== 0)
    throw new Error('无法读取受管进程树，清理不能判为完成。', { cause: result.error })
  const children = new Map(),
    rows = []
  for (const line of result.stdout.trim().split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
    if (!match) throw new Error('受管进程树格式无效。')
    const [child, parent, group] = match.slice(1).map(Number)
    rows.push({ child, group })
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(child)
  }
  const descendants = new Set([pid]),
    queue = [pid]
  for (let i = 0; i < queue.length; i++)
    for (const child of children.get(queue[i]) ?? []) {
      if (descendants.has(child)) continue
      descendants.add(child)
      queue.push(child)
    }
  // detached 子进程是新会话组长；只回收组长也属于该任务树的组，不能波及调用方或其他会话。
  return new Set(rows.filter((r) => descendants.has(r.child) && descendants.has(r.group)).map((r) => r.group))
}

/** 内外层执行器共用同一有界清理：正常完成不扫描；停止后保留各层进程组直至最终强杀。 */
export function processCleanup(pid, { graceMs = 10_000 } = {}) {
  const groups = new Set(Number.isSafeInteger(pid) && pid > 1 ? [pid] : [])
  let stopping = false,
    finished = false,
    timer,
    error
  const kill = (group, signal) => {
    try {
      process.kill(-group, signal)
    } catch (e) {
      if (e.code !== 'ESRCH') error ??= e
    }
  }
  const force = () => {
    if (finished) return
    // 先回收内层组，再回收外层组长，防止外层强杀先于内层自己的宽限计时器。
    for (const group of groups)
      if (group !== pid) kill(group, 'SIGKILL')
    if (groups.has(pid)) kill(pid, 'SIGKILL')
  }
  return {
    stop(signal = 'SIGTERM') {
      if (finished || stopping) return
      stopping = true
      const started = performance.now()
      if (groups.size && graceMs > 0) {
        try {
          for (const group of descendantGroups(pid, Math.min(500, graceMs))) groups.add(group)
        } catch (e) {
          error = e
        }
      }
      if (signal === 'SIGKILL') force()
      else if (groups.has(pid)) kill(pid, signal)
      // 快照也消耗既有宽限；创建补偿耗尽时仍保持零宽限，不叠加第二轮等待。
      timer = setTimeout(force, Math.max(0, graceMs - (performance.now() - started)))
    },
    finish() {
      if (finished) return
      try {
        if (stopping) force()
        if (error) throw error
      } finally {
        finished = true
        clearTimeout(timer)
      }
    }
  }
}
