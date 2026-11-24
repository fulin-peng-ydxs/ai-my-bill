import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync,spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { signingAuthorization } from '../lib/ios-signing.mjs'
import { sourceIdentity } from '../lib/ios-ci-plan.mjs'
import { hashPaths } from '../lib/ios-debug.mjs'

const repository = fileURLToPath(new URL('../..',import.meta.url))
const candidate = {appId:'com.mybill.offline',teamId:'EXAMPLE123'}
const certificate = Buffer.from('synthetic-signer-not-a-real-certificate')
const sha = value => createHash('sha256').update(value).digest('hex')
const authorization = () => ({
  signedEntitlements:{'application-identifier':'PREFIX1234.com.mybill.offline','com.apple.developer.team-identifier':candidate.teamId,
    'get-task-allow':false,'keychain-access-groups':['PREFIX1234.com.mybill.offline']},
  profileEntitlements:{'application-identifier':'PREFIX1234.*','com.apple.developer.team-identifier':candidate.teamId,
    'get-task-allow':true,'keychain-access-groups':['PREFIX1234.*']},
  profileTeamIds:[candidate.teamId],appIdPrefixes:['PREFIX1234'],signingCertificateSHA256:sha(certificate),profileCertificatesSHA256:[sha(certificate)]
})

test('T15 签名授权接受精确/尾部通配、独立 prefix 及主动收窄权限',()=>{
  const value=authorization()
  assert.equal(signingAuthorization(candidate,value),value)
  value.profileEntitlements['application-identifier']=value.signedEntitlements['application-identifier']
  assert.doesNotThrow(()=>signingAuthorization(candidate,value))
})

test('T15 同 Team 的错误 App ID、证书和越权 entitlement 均拒绝，不接受旧签名摘要',()=>{
  assert.throws(()=>signingAuthorization(candidate,undefined))
  for(const mutate of [
    x=>x.profileEntitlements['application-identifier']='PREFIX1234.other.app',
    x=>x.profileEntitlements['application-identifier']='PREFIX1234.*.offline',
    x=>x.signedEntitlements['application-identifier']='PREFIX1234.other.app',
    x=>x.appIdPrefixes=['OTHERPREFIX'],x=>x.profileTeamIds=['OTHERTEAM'],
    x=>x.signedEntitlements['com.apple.developer.team-identifier']='OTHERTEAM',
    x=>x.signingCertificateSHA256='b'.repeat(64),x=>x.profileCertificatesSHA256=[],
    x=>delete x.signedEntitlements['application-identifier'],
    x=>x.signedEntitlements['unauthorized-capability']=true,
    x=>{x.signedEntitlements['get-task-allow']=true;x.profileEntitlements['get-task-allow']=false},
    x=>x.signedEntitlements['keychain-access-groups']=['OTHERPREFIX.other.app'],
    x=>x.signedEntitlements['keychain-access-groups']='PREFIX1234.com.mybill.offline'
  ]){const value=authorization();mutate(value);assert.throws(()=>signingAuthorization(candidate,value),/签名授权不匹配/)}
})

// 测试用 plist 编码器，只生成合成授权；真实 CMS/签名的可信性不由该夹具证明。
function plist(value) {
  const xml = value => {
    if(Buffer.isBuffer(value))return '<data>'+value.toString('base64')+'</data>'
    if(value instanceof Date)return '<date>'+value.toISOString().replace('.000Z','Z')+'</date>'
    if(typeof value==='boolean')return value?'<true/>':'<false/>'
    if(Array.isArray(value))return '<array>'+value.map(xml).join('')+'</array>'
    if(typeof value==='object')return '<dict>'+Object.entries(value).map(([k,v])=>'<key>'+k+'</key>'+xml(v)).join('')+'</dict>'
    return '<string>'+String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</string>'
  }
  return '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">'+xml(value)+'</plist>'
}

test('T15 实际签名 CLI 消费授权字段并在拒绝时不产出回执，临时授权文件均回收',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ios-signing-')))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const write=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file}
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe',timeout:10000})
  write('.gitignore','.local/\n');write('app/src/main.ts','export const fixture=true\n')
  git('init','-q');git('add','.gitignore','app/src/main.ts')
  git('-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture')
  const app=path.join(root,'.local/App.app'),data=authorization(),deviceId='00008120-0000000000000000'
  write('.local/App.app/App','synthetic-app');write('.local/App.app/embedded.mobileprovision','synthetic-profile')
  write('.local/App.app/Info.plist',JSON.stringify({CFBundleIdentifier:candidate.appId,CFBundleShortVersionString:'1.0',CFBundleVersion:'1'}))
  const file=write('.local/candidate.json',JSON.stringify({...candidate,deviceId,version:'1.0',buildVersion:'1',workingTree:false,configuration:'Release',source:sourceIdentity(root),artifactHash:hashPaths(app,['.'])}))
  fs.mkdirSync(path.join(root,'.local/ios/tmp/ai-agent'),{recursive:true,mode:0o700})
  const before=hashPaths(app,['.']),state=path.join(root,'.local/tools/state.json')
  const executable=(name,body)=>{const p=write('.local/tools/'+name,'#!'+process.execPath+'\n'+body);fs.chmodSync(p,0o755)}
  const load=`const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2),s=JSON.parse(fs.readFileSync(path.join(__dirname,'state.json')));`
  executable('codesign',load+`if(a.includes('--verify'))process.exit(0);else if(a.includes('--entitlements')){console.error('controlled diagnostic');console.log(s.entitlements)}else if(a.includes('--extract-certificates'))fs.writeFileSync(a[a.indexOf('--extract-certificates')+1]+'0',Buffer.from(s.certificate,'base64'));else console.error('TeamIdentifier=${candidate.teamId}');`)
  executable('security',load+'console.log(s.profile);')
  executable('plutil',`const fs=require('node:fs'),a=process.argv.slice(2);console.log(JSON.parse(fs.readFileSync(a.at(-1)))[a[a.indexOf('-extract')+1]]);`)
  const preload=write('.local/platform.mjs',"Object.defineProperty(process,'platform',{value:'darwin'});\n")
  for(const mode of ['valid','wrong-app','wrong-cert','unauthorized']){
    const value=structuredClone(data)
    if(mode==='wrong-app')value.profileEntitlements['application-identifier']='PREFIX1234.other.app'
    if(mode==='unauthorized')value.signedEntitlements['unauthorized-capability']=true
    const profile={TeamIdentifier:value.profileTeamIds,ApplicationIdentifierPrefix:value.appIdPrefixes,ProvisionedDevices:[deviceId],
      DeveloperCertificates:[certificate],Entitlements:value.profileEntitlements,ExpirationDate:new Date('2030-01-01T00:00:00Z')}
    write('.local/tools/state.json',JSON.stringify({profile:plist(profile),entitlements:plist(value.signedEntitlements),certificate:(mode==='wrong-cert'?Buffer.from('unauthorized-signer'):certificate).toString('base64')}))
    const output=path.join(root,'.local/'+mode+'.json')
    const result=spawnSync(process.execPath,['--import',preload,path.join(repository,'scripts/ios-signing-check.mjs'),app,file,output],
      {cwd:root,env:{...process.env,PATH:path.dirname(state)+path.delimiter+process.env.PATH},encoding:'utf8',timeout:15000})
    assert.equal(result.status,mode==='valid'?0:1,result.stderr)
    assert.equal(fs.existsSync(output),mode==='valid')
    if(mode==='valid')assert.deepEqual(JSON.parse(fs.readFileSync(output)).authorization,data)
    else assert.match(result.stderr,/签名授权不匹配/)
    assert.ok(!fs.readdirSync(path.join(root,'.local/ios/tmp/ai-agent')).some(name=>name.startsWith('signing-check-')))
    assert.equal(hashPaths(app,['.']),before)
  }
})
