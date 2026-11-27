import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { commandScope } from './ios-process-scope.mjs'

/** 清理失败追加到原执行原因之后，不能以 finally 的异常覆盖超时、取消或命令失败。 */
export function finishCleanup(cleanup, primary, options) {
  try { cleanup?.finish(options) } catch (error) {
    const failure = new AggregateError(primary ? [primary,error] : [error], primary ? '执行失败且清理未完成。' : '进程清理未完成。')
    failure.code = 'IOS_PROCESS_CLEANUP_FAILED'
    throw failure
  }
}

/** 登记在放行补偿工具之前完成；每次外层调用建立独立范围，内层只继承自己的父登记。 */
export function spawnManaged(program, args, options, { root, graceMs = 10_000 }) {
  const scope = commandScope(root, options.env ?? process.env)
  const gated = scope.inherited && graceMs === 0
  let child, cleanup
  try {
    const shellGate=gated && fs.existsSync('/bin/zsh')
    child = spawn(gated ? (shellGate?'/bin/zsh':process.execPath) : program,
      gated ? [...(shellGate?['-f']:[]),fileURLToPath(new URL(shellGate?'./ios-process-launch.sh':'./ios-process-launch.mjs', import.meta.url)), program, ...args] : args,
      { ...options, env: scope.env, stdio: gated ? [...options.stdio, 'pipe', 'pipe'] : options.stdio })
    const channel = gated ? child.stdio[3] : undefined
    channel?.on('error', (error) => child.emit('error', error))
    if (gated) {
      let buffer=''
      const trace=child.stdio[4]
      trace.on('error',error=>child.emit('error',error))
      trace.end() // 本通道只读；关闭父端写半边，避免它阻止 child.close。
      trace.on('data',data=>{
        try {
          buffer+=data.toString()
          if(buffer.length>1024)throw new Error('受管启动诊断帧过大。')
          for(let end;(end=buffer.indexOf('\n'))>=0;) {
            const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1)
            if(!['waiting','frame','starting','started','exited'].includes(value.stage) || value.pid!==child.pid)
              throw new Error('受管启动诊断来源无效。')
            scope.noteLauncher(value)
          }
        } catch(error) {child.emit('error',error)}
      })
    }
    cleanup = processCleanup(child.pid, { graceMs, scope })
    scope.bind(child.pid)
    if (scope.blocked()) {
      channel?.end()
      cleanup.stop('SIGKILL')
    } else if (channel) {
      scope.noteLauncher({stage:'release-requested',pid:child.pid,bytes:3})
      channel.end('GO\n')
    }
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
export function descendantGroups(pid, timeout, { platform = process.platform, execute = spawnSync } = {}) {
  // Darwin reads numeric libproc metadata; retain the same snapshot/grace deadline and failure semantics.
  const program = platform === 'darwin' ? 'python3' : 'ps'
  const args = platform === 'darwin'
    ? ['-I', fileURLToPath(new URL('./ios-host-diagnostics.py', import.meta.url)), '--process-tree']
    : ['-axo', 'pid=,ppid=,pgid=']
  const result = execute(program, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
    killSignal: 'SIGKILL'
  })
  if (result.error || result.status !== 0)
    throw new Error('无法读取受管进程树，清理不能判为完成。', { cause: result.error ?? new Error(`ps exit=${result.status}, signal=${result.signal}`) })
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
      if (e.code !== 'ESRCH') {
        // 权限错误不能视为退出。只探测本次组长的存活，保留组信号与组长状态的区别。
        let leader = 'alive'
        try { process.kill(group,0) } catch (probe) { leader=probe.code ?? 'unknown' }
        error ??= new Error(`清理进程组 ${group} 的 ${signal} 失败（${e.code ?? 'unknown'}，组长=${leader}）。`, { cause:e })
      }
    }
  }
  const force = (handoff = false) => {
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
    // 成功的设备启动请求将本组服务交给 UUID 级生命周期；仍关闭登记并回收其他受管子组。
    if (handoff) groups.delete(pid)
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
    finish({ handoff = false } = {}) {
      if (finished) return
      try {
        // 命令结束也关闭自己的登记分支，避免成功退出的组长遗留后台成员后丢失归属。
        if (stopping || scope) force(handoff && !stopping)
        if (error) throw error
      } finally {
        finished = true
        clearTimeout(timer)
        scope?.finish(error)
      }
    }
  }
}

/** 不捕获到内存的大日志；超时/取消先通知原执行器清理，再限时终止进程组。 */
export async function runCommand(root, program, args, log, timeoutMs = 2_700_000,
  { cleanupGraceMs = 10_000, acceptExit, signal } = {}) {
  // 受控进程回归只缩短清理宽限；正式调用保留默认值，不提供 CLI/环境覆盖或延长预算。
  if (!Number.isSafeInteger(cleanupGraceMs) || cleanupGraceMs < 0 || cleanupGraceMs > 10_000)
    throw new Error('CI 清理宽限必须为 0 至 10000 毫秒。')
  if (signal?.aborted) throw new Error('CI 命令在启动前已取消。')
  const fd = fs.openSync(log, 'wx', 0o600)
  let child,
    timer,
    cleanup,
    primaryError,
    cancelled = false
  const stop = () => {
    cancelled = true
    cleanup?.stop()
  }
  try {
    const code = await new Promise((resolve, reject) => {
      const managed = spawnManaged(program, args, {
        cwd: root,
        env: process.env,
        detached: true,
        stdio: ['ignore', fd, fd]
      }, { root, graceMs: cleanupGraceMs })
      child = managed.child
      cleanup = managed.cleanup
      child.once('error', reject)
      child.once('close', (code) => resolve(code))
      timer = setTimeout(stop, timeoutMs)
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      signal?.addEventListener('abort', stop, {once:true})
      if (signal?.aborted) stop()
    })
    // 默认调用保留原有先判失败的路径；只有精确登记的预期非零终态需要读取输出再判。
    if (cancelled || (!acceptExit && code !== 0)) throw new Error(`CI 命令失败或取消（exit=${code}），见 ${log}`)
    const size = fs.fstatSync(fd).size
    // 输出标识在命令收尾，最多读取尾部 64KiB；日志本体留存供失败诊断。
    const data = Buffer.alloc(Math.min(size, 65_536))
    const source = fs.openSync(log, 'r')
    try {
      fs.readSync(source, data, 0, data.length, size - data.length)
    } finally {
      fs.closeSync(source)
    }
    const output = data.toString('utf8')
    // 预期的非零终态由调用者精确核验；取消始终失败，避免已退出命令误走取消快照/强杀。
    if (acceptExit && !acceptExit(code, output)) throw new Error(`CI 命令失败或取消（exit=${code}），见 ${log}`)
    return output
  } catch (error) {
    primaryError = error
    cleanup?.stop('SIGKILL')
    throw error
  } finally {
    clearTimeout(timer)
    try {
      finishCleanup(cleanup, primaryError)
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      signal?.removeEventListener('abort', stop)
      fs.closeSync(fd)
    }
  }
}
