import fs from 'node:fs'
import path from 'node:path'
import { runCommand } from './ios-processes.mjs'
import { errorMessage } from './ios-errors.mjs'

/** 仅采样本次启动请求的真实子 PID；不匹配进程名，不扫描或调整其他服务。 */
export function observeBootProcess(root, directory, stage, pid, budgetMs, { run = runCommand, schedule = setTimeout, unschedule = clearTimeout, isRunning = () => true } = {}) {
  if (!['boot-request','boot-ready','verify-state'].includes(stage) || !Number.isSafeInteger(pid) || pid<=1)
    throw new Error('启动诊断阶段或子进程 PID 无效。')
  const controller = new AbortController()
  const file = path.join(directory, `boot-diagnostic-${stage}.json`)
  const report = { scope:'diagnostic',stage,pid,budgetMs,startedAt:Date.now(),status:'not-needed' }
  const save = () => {
    try { fs.writeFileSync(file,JSON.stringify(report,null,2),{mode:0o600}) } catch (cause) {
      throw Object.assign(new Error('启动诊断记录写入失败。',{cause}),{code:'IOS_BOOT_DIAGNOSTIC_WRITE_FAILED'})
    }
  }
  let work, cleanupFailure, closed = false
  // 在启动预算内部取一秒栈，最多三秒；离命令截止至少留出七秒，不顺延验收。
  const timer = budgetMs>10_000 ? schedule(() => {
    if (closed) return
    // 定时回调的同步写入与异步失败均归入 work，不能形成未处理异常并遗留启动请求。
    work = (async () => {
        if (!isRunning()) {report.status='exited';save();return}
        report.status='sampling'
        save()
        let exit
        await run(root,'/usr/bin/sample',[String(pid),'1','10','-file',path.join(directory,`boot-stack-${stage}.log`)],
          path.join(directory,`boot-sampler-${stage}.log`),3_000,
          {cleanupGraceMs:0,signal:controller.signal,acceptExit:code=>{exit=code;return true}})
        const stack=path.join(directory,`boot-stack-${stage}.log`)
        report.status=exit===0 && fs.existsSync(stack) && fs.statSync(stack).size>0 ? 'sampled':'unavailable'
        report.exit=exit
      })()
      .catch(error=>{
        report.status=controller.signal.aborted?'cancelled':'unavailable'
        report.error=errorMessage(error)
        if (['IOS_PROCESS_CLEANUP_FAILED','IOS_BOOT_DIAGNOSTIC_WRITE_FAILED'].includes(error.code)) cleanupFailure=error
      }).finally(()=>{
        report.sampleFinishedAt=Date.now()
        try {save()} catch(error) {cleanupFailure ??= error}
      })
  },Math.min(90_000,budgetMs-10_000)) : undefined
  return async () => {
    closed = true
    if (timer!==undefined) unschedule(timer)
    controller.abort()
    await work
    report.completedAt=Date.now()
    save()
    // 诊断不充当验收证据，但诊断进程自身未清理也不能被当作正常收尾。
    if (cleanupFailure) throw cleanupFailure
  }
}
