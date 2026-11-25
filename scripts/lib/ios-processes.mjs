import { spawn, spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { commandScope } from './ios-process-scope.mjs'

/** 清理失败追加到原执行原因之后，不能以 finally 的异常覆盖超时、取消或命令失败。 */
export function finishCleanup(cleanup, primary) {
  try { cleanup?.finish() } catch (error) {
    if (primary) throw new AggregateError([primary, error], '执行失败且清理未完成。')
    throw error
  }
}

/** 登记在放行补偿工具之前完成；每次外层调用建立独立范围，内层只继承自己的父登记。 */
export function spawnManaged(program, args, options, { root, graceMs = 10_000 }) {
  const scope = commandScope(root, options.env ?? process.env)
  const gated = scope.inherited && graceMs === 0
  let child, cleanup
  try {
    child = spawn(gated ? process.execPath : program,
      gated ? [fileURLToPath(new URL('./ios-process-launch.mjs', import.meta.url)), program, ...args] : args,
      { ...options, env: scope.env, stdio: gated ? [...options.stdio, 'pipe'] : options.stdio })
    const channel = gated ? child.stdio[3] : undefined
    channel?.on('error', (error) => child.emit('error', error))
    cleanup = processCleanup(child.pid, { graceMs, scope })
    scope.bind(child.pid)
    if (scope.blocked()) {
      channel?.end()
      cleanup.stop('SIGKILL')
    } else channel?.end('GO\n')
    return { child, cleanup }
  } catch (error) {
    child?.on('error', () => {})
    if (cleanup) {
      cleanup.stop('SIGKILL')
      finishCleanup(cleanup, error)
    } else {
      scope.finish(error)
    }
    throw error
  }
}

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
export function processCleanup(pid, { graceMs = 10_000, scope } = {}) {
  const groups = new Set(Number.isSafeInteger(pid) && pid > 1 ? [pid] : [])
  let stopping = false,
    finished = false,
    timer,
    error
  const kill = (group, signal) => {
    try {
      // 直接发送目标信号；signal 0 的权限探测并不证明实际信号无法发送，退出竞争由 ESRCH 接纳。
      process.kill(-group, signal)
    } catch (e) {
      if (e.code !== 'ESRCH') error ??= new Error(`清理进程组 ${group} 的 ${signal} 失败（${e.code ?? 'unknown'}）。`, { cause:e })
    }
  }
  const force = () => {
    if (finished) return
    if (scope) {
      try {
        scope.seal()
      } catch (e) {
        error ??= e
      }
      // 关闭标记落盘失败不能跳过已经登记的补偿组；保留失败，但仍尽力回收当前范围。
      try {
        for (const group of scope.groups()) groups.add(group)
      } catch (e) {
        error ??= e
      }
    }
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
          for (const group of descendantGroups(pid, Math.min(2_000, graceMs))) groups.add(group)
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
        // 命令结束也关闭自己的登记分支，避免成功退出的组长遗留后台成员后丢失归属。
        if (stopping || scope) force()
        if (error) throw error
      } finally {
        finished = true
        clearTimeout(timer)
        scope?.finish(error)
      }
    }
  }
}
