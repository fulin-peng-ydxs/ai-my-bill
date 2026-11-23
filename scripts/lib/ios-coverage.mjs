import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** 清单包含未被测试导入的业务源码；生成类型与声明不是可执行覆盖目标。 */
export function coverageSources(root) {
  const files = []
  const walk = directory => {
    for (const name of fs.readdirSync(path.join(root,directory)).sort()) {
      const relative = path.posix.join(directory,name), stat = fs.lstatSync(path.join(root,relative))
      if (stat.isSymbolicLink()) throw new Error('覆盖率源码不允许链接。')
      if (stat.isDirectory()) {
        if (relative !== 'app/src/api/generated') walk(relative)
      } else if (/\.(ts|vue)$/.test(name) && !/\.(spec|d)\.ts$/.test(name)) files.push(relative)
    }
  }
  walk('app/src')
  if (!files.length) throw new Error('覆盖率源码为空。')
  return files
}

/** 原始 Istanbul 与 summary 同源校验；不以手填百分比或缺失文件当可信基线。 */
export function coverageReport(root,coverage,summary) {
  const expected = coverageSources(root)
  const normalize = name => {
    const unix = name.replaceAll('\\','/')
    const index = unix.lastIndexOf('/app/src/')
    return index >= 0 ? unix.slice(index+1) : unix
  }
  const raw = Object.entries(coverage).map(([name,value]) => [normalize(name),value])
  if (raw.length !== expected.length || new Set(raw.map(([name]) => name)).size !== raw.length ||
      raw.some(([name]) => !expected.includes(name))) throw new Error('覆盖率遗漏源码或混入其他范围。')
  const keys = value => Object.keys(value ?? {}).sort().join(',')
  for (const [name,value] of raw) {
    if (normalize(value.path ?? '') !== name || keys(value.s) !== keys(value.statementMap) ||
        keys(value.f) !== keys(value.fnMap) || keys(value.b) !== keys(value.branchMap)) throw new Error('覆盖率映射缺失。')
    const counts = [...Object.values(value.s),...Object.values(value.f),...Object.values(value.b).flat()]
    if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('覆盖率计数无效。')
  }
  const summaries = Object.entries(summary).filter(([name]) => name !== 'total')
  if (summaries.length !== expected.length || new Set(summaries.map(([name])=>normalize(name))).size!==expected.length || summaries.some(([name]) => !expected.includes(normalize(name))))
    throw new Error('覆盖率 summary 范围不符。')
  const percentage = (covered,total) => total ? Math.floor(covered*10000/total)/100 : 100
  for (const [name,value] of raw) {
    const summary = summaries.find(([file])=>normalize(file)===name)[1]
    const lines = new Map()
    for (const [key,count] of Object.entries(value.s)) {
      const line = value.statementMap[key]?.start?.line
      if (!Number.isSafeInteger(line) || line < 1) throw new Error('覆盖率行映射无效。')
      lines.set(line,Math.max(lines.get(line) ?? 0,count))
    }
    for (const [metric,counts] of Object.entries({lines:[...lines.values()],statements:Object.values(value.s),functions:Object.values(value.f),branches:Object.values(value.b).flat()})) {
      const total = counts.length, covered = counts.filter(x=>x>0).length
      if (summary[metric]?.total!==total || summary[metric]?.covered!==covered || summary[metric]?.pct!==percentage(covered,total))
        throw new Error('覆盖率逐文件汇总与原始计数不符。')
    }
  }
  const totals = {}
  for (const metric of ['lines','statements','functions','branches']) {
    const values = summaries.map(([,value]) => value[metric])
    for (const value of [...values,summary.total?.[metric]]) {
      if (!value || !Number.isSafeInteger(value.total) || !Number.isSafeInteger(value.covered) ||
          value.covered < 0 || value.covered > value.total || !Number.isFinite(value.pct) || value.pct < 0 || value.pct > 100)
        throw new Error('覆盖率汇总无效。')
    }
    const total = values.reduce((n,value) => n+value.total,0), covered = values.reduce((n,value) => n+value.covered,0)
    if (summary.total[metric].total !== total || summary.total[metric].covered !== covered || summary.total[metric].pct !== percentage(covered,total))
      throw new Error('覆盖率汇总与逐文件不符。')
    totals[metric] = summary.total[metric]
  }
  const sourceHash = createHash('sha256')
  for (const file of expected) sourceHash.update(file+'\0').update(fs.readFileSync(path.join(root,file)))
  return { schema:1,status:'passed',sourceHash:sourceHash.digest('hex'),files:expected,totals,
    thresholds:'baseline-only-no-invented-percentage' }
}
