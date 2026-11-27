import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/** 同步 Shell 辅助调用直接落盘，避免系统后代继承管道后阻塞已退出的请求。 */
export function simctlSync(program, prefix, args, logPrefix) {
  const directory = fs.mkdtempSync(logPrefix + '-')
  const files = ['stdout.log', 'stderr.log'].map(name => path.join(directory, name))
  const descriptors = []
  let result
  try {
    for (const file of files) descriptors.push(fs.openSync(file, 'wx', 0o600))
    result = spawnSync(program, [...prefix, ...args], {
      timeout: 30_000, stdio: ['ignore', ...descriptors]
    })
  } finally {
    for (const fd of descriptors) fs.closeSync(fd)
  }
  return { ...result, stdout: fs.readFileSync(files[0], 'utf8'),
    stderr: fs.readFileSync(files[1], 'utf8'), directory }
}

export function simctlOutput(program, prefix, args, logPrefix) {
  const result = simctlSync(program, prefix, args, logPrefix)
  if (result.error || result.status !== 0)
    throw new Error('simctl 请求失败：exit=' + result.status + ' error=' + (result.error?.code ?? '') +
      '\n' + result.stderr.slice(-2048), { cause: result.error })
  return result.stdout.trim()
}
