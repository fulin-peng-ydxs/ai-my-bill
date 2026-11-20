/** 远端只接受显式请求；change 的起点来自输入或标签，不查询历史绿色和计费 API。 */
export function requestedScope(eventName, event) {
  if (eventName === 'workflow_dispatch') {
    const profile = event.inputs?.verification === undefined ? 'scripts' : event.inputs.verification
    if (!['scripts', 'app', 'final', 'change', 'dependency-audit'].includes(profile))
      throw new Error('未知 CI 范围。')
    return { profile, base: event.inputs?.base_revision || undefined }
  }
  if (eventName === 'push' && !event.deleted) {
    const match = /^refs\/tags\/ios-ci\/(scripts|app|final|dependency-audit)\/(.+)$/.exec(
      event.ref ?? ''
    )
    if (match) return { profile: match[1] }
    const change = /^refs\/tags\/ios-ci\/change\/([a-f0-9]{40})\/(.+)$/i.exec(event.ref ?? '')
    if (change) return { profile: 'change', base: change[1] }
  }
  throw new Error('远端 CI 仅接受手动请求或有效 ios-ci 请求标签。')
}
