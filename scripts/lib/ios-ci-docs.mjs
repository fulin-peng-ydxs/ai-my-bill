import fs from 'node:fs'
import path from 'node:path'
import { registry, remoteSuite } from './ios-ci-plan.mjs'

const begin = '<!-- ios-ci-registry:start -->'
const end = '<!-- ios-ci-registry:end -->'
const document = 'agent-works/testing/guide.md'

/** Only the inventory is generated. Procedure and acceptance policy remain authored prose. */
export function registryBlock(r) {
  const rows = Object.entries(r.suites).map(([name, suite]) => {
    const profiles = Object.entries(r.profiles).filter(([, names]) => names.includes(name)).map(([p]) => p)
    const rules = r.rules.flatMap((rule, i) => rule.suites.includes(name) ? ['R' + (i + 1)] : [])
    const scope = r.onDemandSuites.includes(name) ? '本地按需/最终' : remoteSuite(suite) ? '本地/远端常规' : '仅本地按变更'
    return `| ${name} | ${suite.description} | ${suite.runner}；${scope} | ${profiles.join(', ') || '单套件/按变更'} | ${rules.join('<br>') || '显式选择'} |`
  })
  const rules = [...r.rules.map((rule, i) => ['R' + (i + 1), rule]), ...(r.unknownSource ? [['F', r.unknownSource]] : [])]
    .map(([id, rule]) => `| ${id} | ${rule.paths.join(', ')} | ${(rule.exclude ?? []).join(', ') || '无'} | ${rule.suites.join(', ')} |`)
  return `${begin}\n变更固定基础：${r.changeBase.join(', ')}；F 仅用于尚未命中已知专项的运行期源码。\n\n` +
    `| 套件 | 能力 | 执行环境 | 固定范围 | 影响规则 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n` +
    `| 规则 | 路径 | 排除 | 命中套件 |\n| --- | --- | --- | --- |\n${rules.join('\n')}\n${end}`
}

export function registryDocumentation(root, write = false) {
  const r = registry(root), block = registryBlock(r)
  const file = path.join(root, document), content = fs.readFileSync(file, 'utf8')
  if (content.split(begin).length !== 2 || content.split(end).length !== 2 || content.indexOf(begin) > content.indexOf(end))
    throw new Error('套件文档必须包含唯一且有序的生成区。')
  const expected = content.slice(0, content.indexOf(begin)) + block + content.slice(content.indexOf(end) + end.length)
  if (content !== expected) {
    if (!write) throw new Error('套件登记文档过期：运行 ci:ios-app -- docs --write。')
    fs.writeFileSync(file, expected)
  }
  return { status: 'passed', suites: Object.keys(r.suites).length, updated: write && content !== expected }
}
