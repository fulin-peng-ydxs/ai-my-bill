import fs from 'node:fs'
import path from 'node:path'
import { capacityReport } from './lib/ios-capacity.mjs'

// 只消费一次真实运行的原始输出；不触发构建、不继承历史绿色，也不覆盖现有报告。
const [receiptPath,logPath,outputPath,capturePath,...extra] = process.argv.slice(2)
if (!receiptPath || !logPath || !outputPath || extra.length) throw new Error('用法：node scripts/ios-capacity-report.mjs receipt.json test.log output.json [device-capture.json]')
const log = fs.readFileSync(logPath,'utf8')
const values = [...log.matchAll(/^IOS_CAPACITY_OBSERVATION (\{[^\r\n]*\})$/gm)]
if (values.length !== 1 || !/\*\* TEST (?:EXECUTE )?SUCCEEDED \*\*/.test(log) || /: error: -\[|Test Case .* failed/.test(log))
  throw new Error('容量原始输出缺失、混合多轮或实际测试失败。')
const report = capacityReport(JSON.parse(fs.readFileSync(receiptPath,'utf8')),JSON.parse(values[0][1]),
  capturePath ? JSON.parse(fs.readFileSync(capturePath,'utf8')) : undefined)
fs.mkdirSync(path.dirname(outputPath),{ recursive:true })
fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{ flag:'wx',mode:0o600 })
console.log(`CAPACITY_REPORT=${path.resolve(outputPath)} status=${report.status}`)
if (['incomplete','failed'].includes(report.status)) process.exitCode = 1
