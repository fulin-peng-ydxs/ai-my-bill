import { isDeepStrictEqual } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { hashPaths } from './lib/ios-debug.mjs'
import { sourceIdentity } from './lib/ios-ci-plan.mjs'
import { runCommand } from './lib/ios-ci-run.mjs'
const [appInput,candidateInput,output,...extra] = process.argv.slice(2)
if (process.platform!=='darwin' || !appInput || !candidateInput || !output || extra.length)
  throw new Error('可信 Mac 手动入口：node scripts/ios-signing-check.mjs App.app candidate.json output.json')
const app = fs.realpathSync(appInput), candidate = JSON.parse(fs.readFileSync(candidateInput))
if (app!==path.resolve(appInput) || !app.endsWith('.app') || candidate.workingTree!==false ||
    candidate.configuration!=='Release' || !isDeepStrictEqual(candidate.source,sourceIdentity(process.cwd())) ||
    execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim() ||
    hashPaths(app,['.'])!==candidate.artifactHash) throw new Error('签名候选非干净 Release 或制品不符。')
const directory = fs.mkdtempSync(path.resolve('.local/ios/tmp/ai-agent/signing-check-'))
try {
  await runCommand(process.cwd(),'codesign',['--verify','--deep','--strict',app],path.join(directory,'verify.log'),30000)
  await runCommand(process.cwd(),'codesign',['-d','--verbose=4',app],path.join(directory,'identity.log'),30000)
  const detail = fs.readFileSync(path.join(directory,'identity.log'),'utf8')
  const plist = key => execFileSync('plutil',['-extract',key,'raw','-o','-',path.join(app,'Info.plist')],{encoding:'utf8',timeout:10000}).trim()
  if (!detail.includes('TeamIdentifier='+candidate.teamId) || plist('CFBundleIdentifier')!==candidate.appId ||
      plist('CFBundleShortVersionString')!==candidate.version || plist('CFBundleVersion')!==candidate.buildVersion)
    throw new Error('签名身份或版本不符。')
  await runCommand(process.cwd(),'security',['cms','-D','-i',path.join(app,'embedded.mobileprovision')],path.join(directory,'profile.plist'),30000)
  const summary = JSON.parse(execFileSync('python3',['-c',
    'import plistlib,json,sys; p=plistlib.load(open(sys.argv[1],"rb")); print(json.dumps({"expires":p["ExpirationDate"].isoformat()+"Z","team":p["TeamIdentifier"][0],"device":sys.argv[2] in p.get("ProvisionedDevices",[])}))',
    path.join(directory,'profile.plist'),candidate.deviceId],{encoding:'utf8',timeout:10000}))
  if (summary.team!==candidate.teamId || summary.device!==true || Date.parse(summary.expires)<=Date.now()) throw new Error('描述文件不覆盖设备或已过期。')
  fs.writeFileSync(output,JSON.stringify({schema:1,kind:'codesign',status:'passed',source:candidate.source,
    artifactHash:candidate.artifactHash,appId:candidate.appId,teamId:candidate.teamId,deviceId:candidate.deviceId,
    checkedAt:new Date().toISOString(),profileExpiresAt:summary.expires},null,2)+'\n',{flag:'wx',mode:0o600})
} finally { fs.rmSync(directory,{recursive:true,force:true}) }
