import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

export const swiftLock =
  'app/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'

/** 仅扫描随离线 App 锁定的 npm（含开发/可选传递项）和 Swift 依赖，不加载旧端配置。 */
export function auditDependencies(root) {
  const npm = JSON.parse(fs.readFileSync(path.join(root, 'app/package-lock.json'), 'utf8'))
  const swift = JSON.parse(fs.readFileSync(path.join(root, swiftLock), 'utf8'))
  if (
    !npm.packages ||
    ![2, 3].includes(npm.lockfileVersion) ||
    !Array.isArray(swift.pins) ||
    !swift.pins.length
  )
    throw new Error('依赖锁缺失或格式不支持，不能视为审计通过。')
  const dependencies = new Map()
  const add = (label, query) => dependencies.set(JSON.stringify(query), { label, query })
  for (const [location, p] of Object.entries(npm.packages)) {
    if (!location) continue
    if (!location.includes('node_modules/') || typeof p.version !== 'string' || p.link)
      throw new Error('无法审计 npm 锁项：' + location)
    const name =
      p.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (!name || !p.version) throw new Error('npm 锁项缺少名称或版本。')
    add(`npm:${name}@${p.version}`, { package: { ecosystem: 'npm', name }, version: p.version })
  }
  if (!dependencies.size) throw new Error('npm 审计集合为空。')
  const npmCount = dependencies.size
  for (const pin of swift.pins) {
    const url = new URL(pin.location)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !/^[a-f0-9]{40}$/i.test(pin.state?.revision ?? '')
    )
      throw new Error('Swift 锁项缺少可信仓库或固定 revision。')
    url.pathname = url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '')
    const name = url.href
    const query = pin.state.version
      ? { package: { ecosystem: 'SwiftURL', name }, version: pin.state.version }
      : { commit: pin.state.revision }
    add(`SwiftURL:${name}@${pin.state.version ?? pin.state.revision}`, query)
  }
  return { dependencies: [...dependencies.values()], npmCount, swiftCount: swift.pins.length }
}

/** OSV 每项分页独立续查；缺项、格式异常、超时或网络失败均保留未完成，禁止空结果冒充成功。 */
export async function audit(root, { request = fetch, now = () => performance.now(), budgetMs = 120_000 } = {}) {
  const inventory = auditDependencies(root)
  const started = now(),
    findings = [],
    queried = new Set()
  for (let offset = 0; offset < inventory.dependencies.length; offset += 100) {
    let pending = inventory.dependencies
      .slice(offset, offset + 100)
      .map((d) => ({ ...d, tokens: new Set() }))
    for (let page = 0; pending.length; page++) {
      const remaining = budgetMs - (now() - started)
      if (page >= 10 || remaining <= 0) throw new Error('依赖审计超出分页或整轮预算。')
      const response = await request('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: pending.map((d) => ({ ...d.query, ...(d.token ? { page_token: d.token } : {}) }))
        }),
        signal: AbortSignal.timeout(Math.min(30_000, remaining))
      })
      if (!response.ok) throw new Error('OSV 查询未成功：HTTP ' + response.status)
      const payload = await response.json()
      if (!Array.isArray(payload.results) || payload.results.length !== pending.length)
        throw new Error('OSV 返回依赖数不符。')
      const next = []
      payload.results.forEach((result, index) => {
        if (
          !result ||
          typeof result !== 'object' ||
          Array.isArray(result) ||
          (result.vulns !== undefined && !Array.isArray(result.vulns))
        )
          throw new Error('OSV 结果格式无效。')
        const d = pending[index]
        for (const vuln of result.vulns ?? []) {
          if (typeof vuln.id !== 'string' || !vuln.id.trim()) throw new Error('OSV 漏洞缺少 ID。')
          findings.push({ dependency: d.label, id: vuln.id })
        }
        if (result.next_page_token !== undefined && result.next_page_token !== '') {
          const token = result.next_page_token
          if (typeof token !== 'string' || d.tokens.has(token))
            throw new Error('OSV 分页 token 无效或循环。')
          d.tokens.add(token)
          next.push({ ...d, token })
        } else queried.add(d.label)
      })
      pending = next
    }
  }
  if (queried.size !== inventory.dependencies.length) throw new Error('依赖审计未覆盖全部锁项。')
  return {
    schema: 1,
    status: findings.length ? 'failed' : 'passed',
    checkedAt: new Date().toISOString(),
    count: inventory.dependencies.length,
    npmCount: inventory.npmCount,
    swiftCount: inventory.swiftCount,
    dependencies: inventory.dependencies.map((d) => d.label),
    findings
  }
}
