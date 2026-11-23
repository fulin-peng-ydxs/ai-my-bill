import fs from 'node:fs'
import path from 'node:path'
import { coverageReport } from './lib/ios-coverage.mjs'
const [directory,...extra] = process.argv.slice(2)
if (!directory || extra.length) throw new Error('用法：node scripts/ios-coverage.mjs 本轮报告目录')
const report = coverageReport(process.cwd(),
  JSON.parse(fs.readFileSync(path.join(directory,'coverage-final.json'))),
  JSON.parse(fs.readFileSync(path.join(directory,'coverage-summary.json'))))
fs.writeFileSync(path.join(directory,'coverage-proof.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600})
console.log('COVERAGE_VERIFIED files='+report.files.length)
