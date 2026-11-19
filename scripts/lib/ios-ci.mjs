import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** 远端范围由显式请求决定；不查询历史绿色或因计费/API 故障升级为完整验收。 */
export function ciValidationScope(level = 'scripts') {
  if (!['scripts', 'app', 'final'].includes(level))
    throw new Error('CI 验证范围只允许 scripts / app / final。')
  return {
    level,
    common: level === 'scripts' ? 'scripts' : 'app',
    native: level !== 'scripts',
    final: level === 'final'
  }
}

/**
 * 日常 push/PR 不触发远端。默认分支尚未接入 workflow_dispatch 时，
 * 使用显式 ios-ci/<范围>/<唯一名称> 标签验证该标签指向的提交；普通标签不能启动。
 */
export function requestedScope(eventName, event) {
  if (eventName === 'workflow_dispatch') return ciValidationScope(event.inputs?.verification)
  if (eventName === 'push') {
    const match = /^refs\/tags\/ios-ci\/(scripts|app|final)\/(.+)$/.exec(event.ref ?? '')
    if (match && !event.deleted) return ciValidationScope(match[1])
  }
  throw new Error('远端 CI 仅接受手动运行或 ios-ci/<scripts|app|final>/<唯一名称> 标签。')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    const scope = requestedScope(process.env.GITHUB_EVENT_NAME, event)
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `common=${scope.common}\nnative=${scope.native}\nfinal=${scope.final}\n`)
    console.log(JSON.stringify(scope))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
