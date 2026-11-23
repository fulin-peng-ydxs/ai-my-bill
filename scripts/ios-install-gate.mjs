import { isDeepStrictEqual } from 'node:util'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import { installationGate } from './lib/ios-install-gate.mjs'
import { reconcile,resultsDirectory } from './lib/ios-ci-run.mjs'
import { sourceIdentity } from './lib/ios-ci-plan.mjs'
const [input,output,...extra] = process.argv.slice(2)
if (!input || !output || extra.length) throw new Error('用法：node scripts/ios-install-gate.mjs install-input.json output.json')
const read = file => {
  const absolute = path.resolve(file)
  if (fs.realpathSync(absolute)!==absolute || !fs.lstatSync(absolute).isFile()) throw new Error('交付材料必须为普通文件。')
  return JSON.parse(fs.readFileSync(absolute))
}
if (execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()) throw new Error('安装交付只接受干净候选。')
const args = read(input), candidate = read(args.candidate)
if (path.basename(args.ci)!=='ci-result.json') throw new Error('必须提供现有 CI 结果目录。')
const ci = reconcile(process.cwd(),resultsDirectory(process.cwd(),path.dirname(args.ci)))
if (!isDeepStrictEqual(candidate.source,sourceIdentity(process.cwd()))) throw new Error('候选与当前检出源码不符。')
const result = installationGate(ci,candidate,args.devices.map(read),read(args.signature))
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
console.log('INSTALL_GATE_PASSED')
