import { isDeepStrictEqual } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { hashPaths } from './lib/ios-debug.mjs'
import { sourceIdentity } from './lib/ios-ci-plan.mjs'
import { runCommand } from './lib/ios-ci-run.mjs'
import { signingAuthorization } from './lib/ios-signing.mjs'
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
  if (!detail.split(/\r?\n/).includes('TeamIdentifier='+candidate.teamId) || plist('CFBundleIdentifier')!==candidate.appId ||
      plist('CFBundleShortVersionString')!==candidate.version || plist('CFBundleVersion')!==candidate.buildVersion)
    throw new Error('签名身份或版本不符。')
  await runCommand(process.cwd(),'security',['cms','-D','-i',path.join(app,'embedded.mobileprovision')],path.join(directory,'profile.plist'),30000)
  await runCommand(process.cwd(),'codesign',['-d','--entitlements',':-',app],path.join(directory,'entitlements.plist'),30000)
  const certificates = path.join(directory,'signer-')
  const certificateLog = path.join(directory,'certificates.log')
  try {
    // codesign 的可选前缀必须与选项通过 = 连接，否则会被当作另一个待验签路径。
    await runCommand(process.cwd(),'codesign',['-d','--extract-certificates='+certificates,app],certificateLog,30000)
  } catch (error) {
    // 清理临时授权文件前保留工具诊断；不把 profile/entitlement 内容写入异常。
    const diagnostic = fs.existsSync(certificateLog) ? fs.readFileSync(certificateLog,'utf8').slice(-4096) : ''
    throw new Error('签名证书提取失败：'+diagnostic,{cause:error})
  }
  const summary = JSON.parse(execFileSync('python3',['-c',
    // 工具诊断与 plist 共用日志；只解析完整 plist 区间，不把诊断当授权字段。
    `import plistlib, json, sys, hashlib
from pathlib import Path

def load_plist(file):
    raw = Path(file).read_bytes()
    start = raw.find(b"<?xml")
    if start >= 0:
        end = raw.find(b"</plist>", start)
        if end < 0:
            raise ValueError("Incomplete signing plist")
        raw = raw[start:end + len(b"</plist>")]
    return plistlib.loads(raw)

p = load_plist(sys.argv[1])
e = load_plist(sys.argv[3])
authorization = {
    "signedEntitlements": e,
    "profileEntitlements": p["Entitlements"],
    "profileTeamIds": p["TeamIdentifier"],
    "appIdPrefixes": p["ApplicationIdentifierPrefix"],
    "profileCertificatesSHA256": [hashlib.sha256(x).hexdigest() for x in p["DeveloperCertificates"]],
    "signingCertificateSHA256": hashlib.sha256(Path(sys.argv[4]).read_bytes()).hexdigest(),
}
print(json.dumps({
    "expires": p["ExpirationDate"].isoformat() + "Z",
    "team": p["TeamIdentifier"][0],
    "device": sys.argv[2] in p.get("ProvisionedDevices", []),
    "authorization": authorization,
}))`,
    path.join(directory,'profile.plist'),candidate.deviceId,path.join(directory,'entitlements.plist'),certificates+'0'],{encoding:'utf8',timeout:10000}))
  if (summary.team!==candidate.teamId || summary.device!==true || Date.parse(summary.expires)<=Date.now()) throw new Error('描述文件不覆盖设备或已过期。')
  const authorization = signingAuthorization(candidate,summary.authorization)
  fs.writeFileSync(output,JSON.stringify({schema:1,kind:'codesign',status:'passed',source:candidate.source,
    artifactHash:candidate.artifactHash,appId:candidate.appId,teamId:candidate.teamId,deviceId:candidate.deviceId,
    checkedAt:new Date().toISOString(),profileExpiresAt:summary.expires,authorization},null,2)+'\n',{flag:'wx',mode:0o600})
} finally { fs.rmSync(directory,{recursive:true,force:true}) }
