import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { errorMessage } from '../lib/ios-errors.mjs'
import { finishScale,scaleMemoryReport } from '../lib/ios-scale-run.mjs'
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
  fs.writeFileSync(path.join(app,'src/unused.ts'),'export function unused(){if(Date.now()>0)return 2; return 3}\n')
  fs.writeFileSync(path.join(app,'src/types.ts'),'export interface OnlyType { value:string }\n')
  fs.writeFileSync(path.join(app,'src/Panel.vue'),`<script setup lang="ts">import {ref,computed} from 'vue';const count=ref(1);const next=computed(()=>count.value+1)</script><template><button v-if="count" @click="count++">{{next}}</button></template>`)
  fs.writeFileSync(path.join(app,'src/sample.spec.ts'),"import {it,expect} from 'vitest';import {value} from './used';import Panel from './Panel.vue';it('sample',()=>{expect(value).toBe(1);expect(Panel).toBeDefined()})")
  const config = path.join(app,'vitest.config.mjs'), output = path.join(root,'reports')
  fs.writeFileSync(config,"import vue from '@vitejs/plugin-vue';export default {plugins:[vue()],test:{include:['src/**/*.spec.ts'],coverage:{provider:'v8',include:['src/**/*.{ts,vue}'],exclude:['src/**/*.spec.ts'],reporter:['json','json-summary']}}}")
  await runCommand(app,process.execPath,[path.join(repository,'app/node_modules/vitest/vitest.mjs'),'run','--config',config,'--coverage','--coverage.reportsDirectory='+output],path.join(root,'test.log'),20000)
  const raw = JSON.parse(fs.readFileSync(path.join(output,'coverage-final.json'))), summary = JSON.parse(fs.readFileSync(path.join(output,'coverage-summary.json')))
  const report = coverageReport(root,raw,summary)
  assert.deepEqual(report.files,['app/src/Panel.vue','app/src/types.ts','app/src/unused.ts','app/src/used.ts'])
  const unused = Object.keys(raw).find(x=>x.endsWith('/unused.ts'))
  assert.ok(Object.values(raw[unused].s).every(x=>x===0))
  const zero=structuredClone(raw),zeroSummary=structuredClone(summary)
  for(const value of Object.values(zero)){for(const key of ['s','f'])for(const id of Object.keys(value[key]))value[key][id]=0;for(const id of Object.keys(value.b))value.b[id].fill(0)}
  for(const value of Object.values(zeroSummary))for(const key of ['lines','statements','functions','branches']){value[key].covered=0;value[key].pct=value[key].total?0:100}
  assert.equal(coverageReport(root,zero,zeroSummary).totals.statements.pct,0)
  for (const mutate of [p=>delete p.raw[unused],p=>p.raw[unused].s[0]=-1,p=>delete p.raw[unused].statementMap,
    p=>p.summary.total.lines.covered++,p=>p.summary[unused].statements.covered++,p=>p.summary.total.lines.pct=999,
    p=>{for(const v of Object.values(p.raw))for(const k of ['statementMap','fnMap','branchMap','s','f','b'])v[k]={};for(const v of Object.values(p.summary))for(const k of ['lines','statements','functions','branches'])v[k]={total:0,covered:0,skipped:0,pct:100}},
    p=>{const key=Object.keys(p.raw[unused].fnMap)[0];p.raw[unused].fnMap[key].loc.end.line=-1}]) {
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
      authorization:signingFixture(candidate),deviceId:first.receipt.deviceId,checkedAt:'2026-11-01T00:00:00Z',profileExpiresAt:'2027-01-01T00:00:00Z'},now:Date.parse('2026-11-23T00:00:00Z')}
}
function signingFixture(candidate) {
  return {signedEntitlements:{'application-identifier':'PREFIX1234.'+candidate.appId,'com.apple.developer.team-identifier':candidate.teamId,'get-task-allow':false},
    profileEntitlements:{'application-identifier':'PREFIX1234.*','com.apple.developer.team-identifier':candidate.teamId,'get-task-allow':false},
    profileTeamIds:[candidate.teamId],appIdPrefixes:['PREFIX1234'],signingCertificateSHA256:'a'.repeat(64),profileCertificatesSHA256:['a'.repeat(64)]}
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
    p=>p.signature.profileExpiresAt='2026-01-01',p=>p.signature.deviceId='other',p=>delete p.signature.authorization,p=>p.signature.authorization.profileEntitlements['application-identifier']='PREFIX1234.other.app',p=>p.devices[0].capture.memory.samples[1].webBytes=400_000_000]
  for (const alter of alters) {const p=installFixture();alter(p);assert.throws(()=>gate(p))}
})
test('T15 schema/seed/查询/恢复/锁与未知数据路径选择规模专项，单测不扩展、手动安装不自动选择',()=>{
  const r=registry(repository)
  for (const file of ['app/src/data/migrations/new.sql','app/src/data/seed/defaults.ts','app/src/data/entries/query.ts',
    'app/src/data/management/new.ts','app/package-lock.json','app/src/data/unknown-new.ts','app/src/new-feature.ts',
    'app/src/composables/useReportData.ts','app/src/api/reports.ts','app/src/components/ExpenseEntryForm.vue',
    'app/src/components/IncomeEntryForm.vue','app/src/components/LedgerListItem.vue','app/src/components/AppShell.vue']) {
    const selected=selectSuites(r,'change',[file]).map(s=>s.name)
    for (const name of ['scale-10000','scale-100000']) assert.ok(selected.includes(name),file+'/'+name)
    assert.ok(!selected.includes('install-gate'))
  }
  assert.ok(selectSuites(r,'change',['app/src/data/seed/new.ts']).some(x=>x.name==='recovery'))
  for(const file of ['app/src/data/new.spec.ts','app/src/composables/useReportData.spec.ts','app/src/components/ExpenseEntryForm.spec.ts','app/src/api/types.d.ts'])
    assert.deepEqual(selectSuites(r,'change',[file]).map(x=>x.name),['secrets','app-common'])
  assert.ok(!selectSuites(r,'change',['app/src/views/me/dictionaries/DictionaryDetailView.vue']).some(x=>x.name.startsWith('scale-')))
  const mixed=selectSuites(r,'change',['app/src/composables/useReportData.spec.ts','app/src/composables/useReportData.ts']).map(x=>x.name)
  assert.ok(mixed.includes('ui-report-dimensions')&&mixed.includes('scale-10000'))
})

test('T15 表单与抽屉共享组件选择跨页及容量专项，单测/声明排除且混合变更保留',()=>{
  const r=registry(repository)
  const shared=selectSuites(r,'change',['app/src/components/AppShell.vue']).map(x=>x.name)
  for(const suite of ['ui-entry','ui-personal','ui-lifecycle','ui-query','ui-reports','ui-report-dimensions',
    'ui-data-management','ui-dictionary-0','ui-ios-interaction','scale-10000','scale-100000']) assert.ok(shared.includes(suite),suite)
  for(const component of ['FormField','AppDrawer']) {
    const implementation='app/src/components/'+component+'.vue'
    const spec='app/src/components/'+component+'.spec.ts', declaration='app/src/components/'+component+'.d.ts'
    assert.deepEqual(selectSuites(r,'change',[implementation]).map(x=>x.name),shared)
    assert.deepEqual(selectSuites(r,'change',[spec,declaration]).map(x=>x.name),['secrets','app-common'])
    assert.deepEqual(selectSuites(r,'change',[spec,declaration,implementation]).map(x=>x.name),shared)
  }
  assert.ok(!shared.includes('touch') && !shared.includes('install-gate'))
  assert.ok(!selectSuites(r,'change',['app/src/components/SettingsGroup.vue']).some(x=>x.name.startsWith('scale-')))
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
    spans:Object.fromEntries(Object.entries(original.capture.spans).filter(([key])=>!['coldStart','backup','restore'].includes(key)).map(([key,spans])=>[key,spans.map(x=>({start:x.start+1200,end:x.end+1200}))]))}
  const coldEvents=Array.from({length:5},(_,sampleIndex)=>({...common,datasetId:'dataset',sampleIndex,deviceId:receipt.deviceId,mode:'simulator',clockDefinition:'automation-upper-bound',samples:[1],spans:[{start:3010+sampleIndex*20,end:3011+sampleIndex*20}]}))
  const passed=ids=>ids.map(id=>`Test Case '-[${id.split('/')[0]}.${id.split('/')[1]} ${id.split('/')[2]}]' passed`).join('\n')
  const success='\n** TEST EXECUTE SUCCEEDED **\n'
  const log=(label,event,ids)=>label+' '+JSON.stringify(event)+'\n'+passed(ids)+success
  const logs={ 'capacity-prepare.log':log('IOS_CAPACITY_FIXTURE',fixture,[selected.cases[0]]),
    'capacity-native.log':log('IOS_CAPACITY_OBSERVATION',native,[selected.cases[1]]),
    'capacity-pages.log':log('IOS_CAPACITY_PAGES',pages,[selected.cases[2]]),
    'capacity-cold.log':coldEvents.map(x=>'IOS_CAPACITY_COLD_SAMPLE '+JSON.stringify(x)).join('\n')+'\n'+passed(selected.cases.slice(3))+success }
  fs.writeFileSync(file,logs['capacity-cold.log'])
  const report={...capacityReport(receipt,native),phase:'all',receipt,fixtureReceipt:fixture,pages,cold:readScaleCold(file),memory:scaleMemoryReport({...receipt,datasetId:fixture.datasetId},[1150,1600,3100].map(at=>({at,appPid:1,webPid:2,appBytes:21,webBytes:31})),[],1100,3250)}
  const result={scope:'partial',status:'passed',requested:{kind:'scenario',name:'scale-10000'},executedCases:selected.cases,
    completedAt:3300,environment:toolchain,sourceHash:receipt.sourceHash,simulatorId:receipt.deviceId,coverage:selected.cases.map(x=>'case/'+x),
    timings:[[selected.cases.slice(0,1),1000,1100],[selected.cases.slice(1,2),1100,1200],[selected.cases.slice(2,3),1200,3000],[selected.cases.slice(3),3000,3200]].map(([ids,startedAt,finishedAt])=>({status:'passed',startedAt,finishedAt,coverage:ids.map(id=>'case/'+id)}))}
  logs['capacity-report.json']=JSON.stringify(report)
  const check=p=>validateScenario(repository,'scale-10000',p.result,name=>{if(!p.logs[name])throw Error('missing');return p.logs[name]},name=>{fs.writeFileSync(file,p.logs[name]);return readScaleCold(file)})
  assert.doesNotThrow(()=>check({result,logs}))
  const alterCold=(p,key,value)=>{
    p.logs['capacity-cold.log']=p.logs['capacity-cold.log'].split('\n').map(line=>{
      if(!line.startsWith('IOS_CAPACITY_COLD_SAMPLE '))return line
      const x=JSON.parse(line.slice('IOS_CAPACITY_COLD_SAMPLE '.length));x[key]=value;return 'IOS_CAPACITY_COLD_SAMPLE '+JSON.stringify(x)
    }).join('\n')
    fs.writeFileSync(file,p.logs['capacity-cold.log'])
    const report=JSON.parse(p.logs['capacity-report.json']);report.cold=readScaleCold(file);p.logs['capacity-report.json']=JSON.stringify(report)
  }
  const alterMemory=(p,change)=>{const report=JSON.parse(p.logs['capacity-report.json']);change(report.memory);p.logs['capacity-report.json']=JSON.stringify(report)}
  // 同步原始页面日志及派生报告，确保拒绝来自时间窗语义，而非副本不一致。
  const alterPageWindow=(p,duration)=>{
    const report=JSON.parse(p.logs['capacity-report.json']),pages=report.pages
    pages.samples.list[0]=0.5
    pages.spans.list[0].end=pages.spans.list[0].start+duration
    p.logs['capacity-pages.log']=p.logs['capacity-pages.log'].replace(/^IOS_CAPACITY_PAGES .*$/m,'IOS_CAPACITY_PAGES '+JSON.stringify(pages))
    p.logs['capacity-report.json']=JSON.stringify(report)
  }
  const subMillisecond={result:structuredClone(result),logs:{...logs}}
  alterPageWindow(subMillisecond,0.5)
  assert.doesNotThrow(()=>check(subMillisecond),'合法亚毫秒时间窗仍接纳')
  for(const duration of [0,-0.25]) {
    const p={result:structuredClone(result),logs:{...logs}}
    alterPageWindow(p,duration)
    assert.throws(()=>check(p),/页面缺少指标或时间窗/)
  }
  for(const mutate of [
    p=>alterCold(p,'deviceId','foreign-device'),p=>alterCold(p,'mode','device'),p=>alterCold(p,'clockDefinition','launch-only'),
    p=>alterMemory(p,m=>m.runId='other'),p=>alterMemory(p,m=>m.deviceId='other'),p=>alterMemory(p,m=>m.datasetId='other'),
    p=>alterMemory(p,m=>delete m.samples[0].at),p=>alterMemory(p,m=>m.samples[0].at=-1),
    p=>alterMemory(p,m=>m.samples.reverse()),p=>alterMemory(p,m=>m.samples[1].at=m.samples[0].at),
    p=>alterMemory(p,m=>m.windowStart=0),p=>alterMemory(p,m=>m.windowEnd=9999),
    p=>alterMemory(p,m=>m.samples=[{...m.samples[0],at:3100},{...m.samples[1],at:3110}]),
    p=>delete p.logs['capacity-native.log'],p=>delete p.result.timings,p=>p.result.timings.pop(),
    p=>p.result.timings[0].status='running',p=>p.result.status='cancelled',
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


test('T15 主失败与补偿失败经过落盘仍保留，原因链有界且循环不递归失控',async t=>{
  const root=temporary(t), file=path.join(root,'result.json')
  const primary=new Error('PRIMARY_DATASET_MISMATCH',{cause:new Error('SOURCE_INTEGRITY_FAILED')})
  try { await finishScale({failure:primary,stop:async()=>{throw new Error('SECONDARY_STOP_FAILED')}});assert.fail('must reject') }
  catch(error){fs.writeFileSync(file,JSON.stringify({error:errorMessage(error)}))}
  const result=JSON.parse(fs.readFileSync(file));for(const message of ['PRIMARY_DATASET_MISMATCH','SOURCE_INTEGRITY_FAILED','SECONDARY_STOP_FAILED'])assert.ok(result.error.includes(message))
  const cyclic=new Error('CYCLE');cyclic.cause=cyclic;assert.match(errorMessage(cyclic),/重复原因/)
  assert.ok(errorMessage(new AggregateError(Array.from({length:100},()=>new Error('x'.repeat(10000))),'root')).length<=8192)
})

test('T15 真实 CLI 的落盘与 stderr 保留聚合主失败，不触发工具链或模拟器',t=>{
  const root=temporary(t)
  fs.mkdirSync(path.join(root,'scripts'),{recursive:true});fs.mkdirSync(path.join(root,'app/native-tests'),{recursive:true})
  fs.cpSync(path.join(repository,'scripts/lib'),path.join(root,'scripts/lib'),{recursive:true})
  fs.copyFileSync(path.join(repository,'scripts/ios-app.mjs'),path.join(root,'scripts/ios-app.mjs'))
  fs.copyFileSync(path.join(repository,'app/native-tests/scenarios.json'),path.join(root,'app/native-tests/scenarios.json'))
  const preload=path.join(root,'inject.mjs')
  fs.writeFileSync(preload,`import fs from 'node:fs';const original=fs.renameSync;let fired=false;fs.renameSync=(from,to)=>{if(!fired&&String(to).includes('/ios-invocation-')){fired=true;throw new AggregateError([new Error('PRIMARY_FAILURE'),new Error('CLEANUP_FAILURE')],'combined')}return original(from,to)};`)
  const child=spawnSync(process.execPath,['--import',preload,'scripts/ios-app.mjs','debug','create'],{cwd:root,encoding:'utf8',timeout:10000})
  assert.equal(child.status,1);assert.match(child.stderr,/PRIMARY_FAILURE/);assert.match(child.stderr,/CLEANUP_FAILURE/)
  const base=path.join(root,'.local/ios/tmp/ai-agent'),dir=fs.readdirSync(base).find(x=>x.startsWith('ios-invocation-'))
  const result=JSON.parse(fs.readFileSync(path.join(base,dir,'result.json')))
  assert.equal(result.status,'failed');assert.match(result.error,/PRIMARY_FAILURE/);assert.match(result.error,/CLEANUP_FAILURE/)
  assert.ok(!fs.existsSync(path.join(base,'ios-command.lock')))
})
