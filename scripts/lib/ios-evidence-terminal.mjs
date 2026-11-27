import fs from 'node:fs'
import path from 'node:path'

/** Shared, read-only command terminal check; registration supplies the original link. */
export function assertEvidenceTerminal(root, measured, result) {
  const read = file => {
    if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile() || fs.statSync(file).size > 1024*1024)
      throw new Error('局部命令登记必须为有界受管普通文件。')
    return JSON.parse(fs.readFileSync(file,'utf8'))
  }
  if (!/^\.local\/ios\/tmp\/ai-agent\/ios-invocation-[A-Za-z0-9]+\/result.json$/.test(measured.invocation ?? ''))
    throw new Error('局部缺少受管命令终态。')
  const invocation = read(path.join(root,measured.invocation))
  if (invocation.scope !== 'invocation' || invocation.mode !== 'debug run' || invocation.status !== 'passed' ||
      invocation.cancelled || invocation.startedAt > measured.startedAt || invocation.finishedAt < result.completedAt ||
      !Number.isSafeInteger(invocation.finishedAt) || !Number.isSafeInteger(invocation.startedAt) ||
      !Number.isSafeInteger(invocation.ownerPid) || invocation.ownerPid <= 1 ||
      measured.ownerPid !== undefined && measured.ownerPid !== invocation.ownerPid)
    throw new Error('局部命令未完成、取消、失败或归属不符。')
  const lock = path.join(root,'.local/ios/tmp/ai-agent/ios-command.lock/owner.json')
  if (fs.existsSync(lock) && read(lock).pid === invocation.ownerPid)
    throw new Error('局部命令尚未完成收尾。')
}
