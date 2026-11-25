/** PR 自动按变更规划；其余远端执行仍需显式请求，不查询历史绿色或计费 API。 */
export function requestedScope(eventName, event) {
  if (eventName === 'pull_request') {
    const base = event.pull_request?.base?.sha, head = event.pull_request?.head?.sha
    if (![base, head].every(value => /^[a-f0-9]{40}$/i.test(value ?? '') && !/^0+$/.test(value)))
      throw new Error('PR 必须提供可核实的完整 base/head SHA。')
    return { profile: 'pull-request', base, head }
  }
  if (eventName === 'workflow_dispatch') {
    const profile = event.inputs?.verification === undefined ? 'scripts' : event.inputs.verification
    if (!['scripts', 'app', 'final', 'change', 'dependency-audit', 'recovery', 'scale-10000', 'scale-100000'].includes(profile))
      throw new Error('未知 CI 范围。')
    return { profile, base: event.inputs?.base_revision || undefined }
  }
  if (eventName === 'push' && !event.deleted) {
    const match = /^refs\/tags\/ios-ci\/(scripts|app|final|dependency-audit|recovery|scale-10000|scale-100000)\/(.+)$/.exec(
      event.ref ?? ''
    )
    if (match) return { profile: match[1] }
    const change = /^refs\/tags\/ios-ci\/change\/([a-f0-9]{40})\/(.+)$/i.exec(event.ref ?? '')
    if (change) return { profile: 'change', base: change[1] }
  }
  throw new Error('远端 CI 仅接受 PR、手动请求或有效 ios-ci 请求标签。')
}

/** 汇总门禁必须实际成功；空值、取消和跳过均不能通过。 */
export function requireJobs(planStatus, checksStatus) {
  if (planStatus !== 'success' || checksStatus !== 'success')
    throw new Error(`CI 必需作业未成功：plan=${planStatus ?? 'missing'}, checks=${checksStatus ?? 'missing'}。`)
}

/** 公共 runner 的锁定包必须来自官方 HTTPS 源；不在依赖安装阶段才等待私有镜像超时。 */
export function assertNpmSources(lock) {
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    if (entry.resolved === undefined) continue
    let url
    try { url = new URL(entry.resolved) } catch { /* 统一拒绝，不输出可能含凭据的 URL。 */ }
    if (!url || url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' ||
      url.port || url.username || url.password || url.search || url.hash)
      throw new Error('CI 依赖下载源须为 npm 官方 HTTPS：' + name)
  }
}
