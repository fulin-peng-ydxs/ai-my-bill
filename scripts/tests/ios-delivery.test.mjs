import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { coverageReport } from '../lib/ios-coverage.mjs'
import { installationGate } from '../lib/ios-install-gate.mjs'
import { registry,selectSuites } from '../lib/ios-ci-plan.mjs'
import { runCommand } from '../lib/ios-ci-run.mjs'
import { capacityEvidenceFixture } from '../fixtures/capacity-report.mjs'

const repository = path.resolve(fileURLToPath(new URL('../..',import.meta.url)))
const temporary = t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ios-delivery-')))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  return root
}

test('T15 真实 V8 采集包含未导入文件；缺文件、映射、坏计数与伪造汇总均拒绝',async t => {
  const root = temporary(t), app = path.join(root,'app')
  fs.mkdirSync(path.join(app,'src'),{recursive:true})
  fs.symlinkSync(path.join(repository,'app/node_modules'),path.join(app,'node_modules'))
  fs.writeFileSync(path.join(app,'src/used.ts'),'export const value=1\n')
  fs.writeFileSync(path.join(app,'src/unused.ts'),'export function unused(){return 2}\n')
  fs.writeFileSync(path.join(app,'src/sample.spec.ts'),"import {it,expect} from 'vitest';import {value} from './used';it('sample',()=>expect(value).toBe(1))")
  const config = path.join(app,'vitest.config.mjs'), output = path.join(root,'reports')
  fs.writeFileSync(config,"export default {test:{include:['src/**/*.spec.ts'],coverage:{provider:'v8',include:['src/**/*.ts'],exclude:['src/**/*.spec.ts'],reporter:['json','json-summary']}}}")
  await runCommand(app,process.execPath,[path.join(repository,'app/node_modules/vitest/vitest.mjs'),'run','--config',config,'--coverage','--coverage.reportsDirectory='+output],path.join(root,'test.log'),20000)
  const raw = JSON.parse(fs.readFileSync(path.join(output,'coverage-final.json'))), summary = JSON.parse(fs.readFileSync(path.join(output,'coverage-summary.json')))
  const report = coverageReport(root,raw,summary)
  assert.deepEqual(report.files,['app/src/unused.ts','app/src/used.ts'])
  const unused = Object.keys(raw).find(x=>x.endsWith('/unused.ts'))
  assert.ok(Object.values(raw[unused].s).every(x=>x===0))
  for (const mutate of [p=>delete p.raw[unused],p=>p.raw[unused].s[0]=-1,p=>delete p.raw[unused].statementMap,
    p=>p.summary.total.lines.covered++,p=>p.summary[unused].statements.covered++,p=>p.summary.total.lines.pct=999]) {
    const p = {raw:structuredClone(raw),summary:structuredClone(summary)}; mutate(p)
    assert.throws(()=>coverageReport(root,p.raw,p.summary))
  }
})

function installFixture() {
  const source = {commit:'c'.repeat(40),hash:'d'.repeat(64)}
  const suites = ['app-common','native-build','native-sqlite','touch','dependency-audit','scale-10000','scale-100000']
  const first = capacityEvidenceFixture(),second = capacityEvidenceFixture()
  second.observation.count=second.capture.count=second.capture.memory.count=100000
  const candidate = {source,configuration:'Release',workingTree:false,debugger:false,appId:'com.mybill.offline',
    artifactHash:'f'.repeat(64),capacityArtifactHash:first.receipt.artifactHash,measurementSourceHash:first.receipt.sourceHash,
    teamId:first.receipt.teamId,version:first.receipt.appVersion,buildVersion:first.receipt.buildVersion}
  return {ci:{status:'passed',profile:'final',completeCandidate:true,source,suites:suites.map(suite=>({suite,status:'passed'}))},candidate,
    devices:[first,second].map(p=>({receipt:p.receipt,observation:p.observation,capture:p.capture})),
    signature:{status:'passed',kind:'codesign',source,artifactHash:candidate.artifactHash,appId:candidate.appId,teamId:candidate.teamId,
      deviceId:first.receipt.deviceId,checkedAt:'2026-11-01T00:00:00Z',profileExpiresAt:'2027-01-01T00:00:00Z'},now:Date.parse('2026-11-23T00:00:00Z')}
}
const gate = p => installationGate(p.ci,p.candidate,p.devices,p.signature,p.now)
test('T15 安装汇总仅在工程、签名、1 万硬指标和 10 万完整观测全部满足后通过',()=>{
  assert.equal(gate(installFixture()).status,'passed')
  const reordered=installFixture()
  reordered.candidate.source={hash:reordered.candidate.source.hash,commit:reordered.candidate.source.commit}
  assert.equal(gate(reordered).status,'passed')
  const p = installFixture()
  p.devices[1].capture.samples.save.fill(2000)
  p.devices[1].capture.spans.save=Array(30).fill({start:0,end:2000})
  p.devices[1].capture.memory.windowEnd=2000
  p.devices[1].capture.memory.samples=Array.from({length:5},(_,i)=>({...p.devices[1].capture.memory.samples[0],at:i*500}))
  assert.equal(gate(p).observations[1].status,'observed-over-target')
})
test('T15 安装汇总拒绝缺手机/缺报告、旧候选、Debug/模拟器、少样本、失控增长、取消及 1 万超标',()=>{
  const alters=[p=>p.devices=[],p=>p.devices.pop(),p=>p.devices[0].receipt.mode='simulator',p=>p.devices[0].receipt.debugger=true,
    p=>p.devices[0].receipt.deviceModel='iPhone 13',p=>p.devices[0].capture.samples.save.pop(),p=>delete p.devices[0].capture.samples['EXPENSE.QUALITY'],
    p=>p.devices[0].capture.unboundedGrowth=true,p=>p.devices[1].capture.crashed=true,p=>p.ci.status='cancelled',p=>p.ci.suites.pop(),
    p=>p.candidate.artifactHash='a'.repeat(64),p=>p.devices[0].receipt.commit='a'.repeat(40),p=>p.devices[0].receipt.artifactHash='a'.repeat(64),
    p=>p.signature.profileExpiresAt='2026-01-01',p=>p.signature.deviceId='other',p=>p.devices[0].capture.memory.samples[1].webBytes=400_000_000]
  for (const alter of alters) {const p=installFixture();alter(p);assert.throws(()=>gate(p))}
})
test('T15 schema/seed/查询/恢复/锁与未知数据路径选择规模专项，单测不扩展、手动安装不自动选择',()=>{
  const r=registry(repository)
  for (const file of ['app/src/data/migrations/new.sql','app/src/data/seed/defaults.ts','app/src/data/entries/query.ts',
    'app/src/data/management/new.ts','app/package-lock.json','app/src/data/unknown-new.ts','app/src/new-feature.ts']) {
    const selected=selectSuites(r,'change',[file]).map(s=>s.name)
    for (const name of ['scale-10000','scale-100000']) assert.ok(selected.includes(name),file+'/'+name)
    assert.ok(!selected.includes('install-gate'))
  }
  assert.ok(selectSuites(r,'change',['app/src/data/seed/new.ts']).some(x=>x.name==='recovery'))
  assert.deepEqual(selectSuites(r,'change',['app/src/data/new.spec.ts']).map(x=>x.name),['secrets','app-common'])
})

test('T15 规模原始报告拒绝缺阶段、少跑、混轮、过时源码及伪造页面/内存指标',async t=>{
  const {validateScenario}=await import('../lib/ios-scenario-evidence.mjs')
  const {selection,sourceHash}=await import('../lib/ios-debug.mjs')
  const {readScaleCold}=await import('../lib/ios-scale-run.mjs')
  const {capacityReport}=await import('../lib/ios-capacity.mjs')
  const root=temporary(t), file=path.join(root,'cold.log')
  const selected=selection('--scenario','scale-10000',[]), toolchain='test-environment'
  const original=capacityEvidenceFixture()
  const receipt={...original.receipt,mode:'simulator',count:10000,sourceHash:sourceHash(repository,toolchain)}
  const common={runId:receipt.runId,sourceHash:receipt.sourceHash,artifactHash:receipt.artifactHash,count:10000}
  const fixture={...common,datasetId:'dataset',fixturePath:'fixture.sqlite'}
  const native={...original.observation,...common,mode:'simulator'}
  const pages={...common,datasetId:'dataset',scope:'page-e2e',correctness:true,crashed:false,
    samples:Object.fromEntries(Object.entries(original.capture.samples).filter(([key])=>!['coldStart','backup','restore'].includes(key))),
    spans:Object.fromEntries(Object.entries(original.capture.spans).filter(([key])=>!['coldStart','backup','restore'].includes(key)))}
  const coldEvents=Array.from({length:5},(_,sampleIndex)=>({...common,datasetId:'dataset',sampleIndex,deviceId:receipt.deviceId,mode:'simulator',clockDefinition:'automation-upper-bound',samples:[1],spans:[{start:sampleIndex*2,end:sampleIndex*2+1}]}))
  const passed=ids=>ids.map(id=>`Test Case '-[${id.split('/')[0]}.${id.split('/')[1]} ${id.split('/')[2]}]' passed`).join('\n')
  const success='\n** TEST EXECUTE SUCCEEDED **\n'
  const log=(label,event,ids)=>label+' '+JSON.stringify(event)+'\n'+passed(ids)+success
  const logs={ 'capacity-prepare.log':log('IOS_CAPACITY_FIXTURE',fixture,[selected.cases[0]]),
    'capacity-native.log':log('IOS_CAPACITY_OBSERVATION',native,[selected.cases[1]]),
    'capacity-pages.log':log('IOS_CAPACITY_PAGES',pages,[selected.cases[2]]),
    'capacity-cold.log':coldEvents.map(x=>'IOS_CAPACITY_COLD_SAMPLE '+JSON.stringify(x)).join('\n')+'\n'+passed(selected.cases.slice(3))+success }
  fs.writeFileSync(file,logs['capacity-cold.log'])
  const report={...capacityReport(receipt,native),phase:'all',receipt,fixtureReceipt:fixture,pages,cold:readScaleCold(file),memory:{samples:[{appPid:1,webPid:2,appBytes:20,webBytes:30},{appPid:1,webPid:2,appBytes:21,webBytes:31}],peakBytes:52}}
  const result={scope:'partial',status:'passed',requested:{kind:'scenario',name:'scale-10000'},executedCases:selected.cases,
    environment:toolchain,sourceHash:receipt.sourceHash,simulatorId:receipt.deviceId,coverage:selected.cases.map(x=>'case/'+x),
    timings:selected.cases.map(id=>({status:'passed',coverage:['case/'+id]}))}
  logs['capacity-report.json']=JSON.stringify(report)
  const check=p=>validateScenario(repository,'scale-10000',p.result,name=>{if(!p.logs[name])throw Error('missing');return p.logs[name]},name=>{fs.writeFileSync(file,p.logs[name]);return readScaleCold(file)})
  assert.doesNotThrow(()=>check({result,logs}))
  for(const mutate of [p=>delete p.logs['capacity-native.log'],p=>p.result.timings.pop(),p=>p.result.status='cancelled',
    p=>p.result.sourceHash='f'.repeat(64),p=>p.logs['capacity-cold.log']=p.logs['capacity-cold.log'].replace("testColdLaunch05]' passed", "testColdLaunch05]' skipped"),
    p=>{const r=JSON.parse(p.logs['capacity-report.json']);r.pages.datasetId='foreign';p.logs['capacity-report.json']=JSON.stringify(r)},
    p=>{const r=JSON.parse(p.logs['capacity-report.json']);r.memory.peakBytes=1;p.logs['capacity-report.json']=JSON.stringify(r)},
    p=>{const r=JSON.parse(p.logs['capacity-report.json']);r.phase='native';p.logs['capacity-report.json']=JSON.stringify(r)},
    p=>{const r=JSON.parse(p.logs['capacity-report.json']);r.memory.samples[0].appPid=0;p.logs['capacity-report.json']=JSON.stringify(r)}]) {
    const p={result:structuredClone(result),logs:{...logs}};mutate(p);assert.throws(()=>check(p))
  }
})


test('T15 final 缺任一规模观测须拒绝，不将普通 App 范围升级为完整候选',t=>{
  const root=temporary(t)
  for(const file of ['config/ios-ci.json','app/ios/App/UITests/DictionaryTouchTests.swift']) {
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true})
    fs.copyFileSync(path.join(repository,file),path.join(root,file))
  }
  const file=path.join(root,'config/ios-ci.json'),original=JSON.parse(fs.readFileSync(file))
  for(const name of ['scale-10000','scale-100000']) {
    const value=structuredClone(original)
    value.profiles.final=value.profiles.final.filter(x=>x!==name)
    value.suites['native-sqlite'].scenario=name
    fs.writeFileSync(file,JSON.stringify(value))
    assert.throws(()=>registry(root),/固定范围缺少必需门禁/)
  }
  assert.ok(!selectSuites(original,'app').some(x=>x.name.startsWith('scale-')))
})
