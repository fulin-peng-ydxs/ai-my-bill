import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { capacityReport,scaleAppId,scaleMetrics,percentile95 } from '../lib/ios-capacity.mjs'
import { selection } from '../lib/ios-debug.mjs'
import { bindScalePlan,verifyScaleFixture,assertScaleLease,resolveScaleProcesses,readScaleEvent,readScaleCold,finishScale } from '../lib/ios-scale-run.mjs'
function fixture() {
  const receipt = { runId:'00000000-0000-4000-8000-000000000001',sourceHash:'a'.repeat(64),artifactHash:'b'.repeat(64),
    commit:'c'.repeat(40),mode:'device',appId:scaleAppId,configuration:'Release',debugger:false,workingTree:false,
    deviceModel:'iPhone 14 Pro Max',iosVersion:'27.0.1',deviceId:'00008120-0000000000000000',teamId:'EXAMPLE123',
    xcodeVersion:'27.0',sqliteVersion:'3',pluginVersion:'8.1.1',appVersion:'1.0',buildVersion:'1' }
  const samples = Object.fromEntries(scaleMetrics.filter(x => !['coldStart','filter','backup','restore'].includes(x)).map(key => ['sqlite.'+key,Array(30).fill(1)]))
  samples['files.backup'] = Array(5).fill(1); samples['files.restore'] = Array(5).fill(1)
  const observation = { ...receipt,count:10000,fixture:{ version:1 },measurementScope:'native-services-not-page-e2e',samples }
  const capture = { ...receipt,count:10000,fixtureVersion:1,scope:'page-e2e',evidenceHash:'d'.repeat(64),
    samples:Object.fromEntries(scaleMetrics.map(x => [x,Array(['coldStart','backup','restore'].includes(x) ? 5 : 30).fill(1)])),
    correctness:true,crashed:false,unboundedGrowth:false,memory:{ ...receipt,count:10000,windowStart:0,windowEnd:1000,evidenceHash:'e'.repeat(64),
      samples:[0,500,1000].map(at => ({ at,appPid:10,webPid:11,appBytes:20,webBytes:30 })) } }
  let clock = 0
  capture.spans = Object.fromEntries(Object.entries(capture.samples).map(([key,values]) => [key,values.map(value => {
    const start = clock; clock += value; return { start,end:clock }
  })]))
  return { receipt,observation,capture }
}
test('模拟器服务观测不充当真机验收，缺少页面/冷启动/组合内存不得通过',() => {
  const { receipt,observation,capture } = fixture()
  assert.equal(capacityReport({ ...receipt,mode:'simulator' },observation).deviceAcceptance,'not-verified')
  assert.equal(capacityReport(receipt,observation).status,'incomplete')
  assert.throws(() => capacityReport({ ...receipt,mode:'simulator' },observation,capture),/模拟器/)
  assert.equal(capacityReport(receipt,observation,capture).status,'passed')
  assert.equal(percentile95(Array.from({ length:30 },(_,i) => i+1)),29)
})
test('拒绝短采样、旧制品、错误数据、Debug、错误设备和仅主进程内存',() => {
  for (const alter of [p => p.capture.samples.list.pop(),p => p.capture.artifactHash='f'.repeat(64),
    p => p.receipt.debugger=true,p => p.receipt.workingTree=true,p => p.receipt.configuration='Debug',p => p.receipt.appId='com.mybill.offline',
    p => p.capture.count=100000,p => p.receipt.deviceModel='iPhone 13',p => p.capture.memory.samples[1].webBytes=0,
    p => p.capture.memory.samples[1].webPid=10,p => p.capture.memory.samples.splice(1,1),
    p => delete p.observation.samples['sqlite.EXPENSE.QUALITY'],p => p.capture.correctness=false]) {
    const p = fixture(); alter(p); assert.throws(() => capacityReport(p.receipt,p.observation,p.capture))
  }
})
test('1 万条超标失败，10 万条仅耗时超标可观测，正确性和崩溃仍拒绝',() => {
  const p = fixture(); p.capture.samples.list.fill(2000)
  p.capture.spans.list = Array(30).fill({ start:0,end:2000 })
  p.capture.memory.windowEnd = 2000
  p.capture.memory.samples = Array.from({ length:5 },(_,i) => ({ ...p.capture.memory.samples[0],at:i*500 }))
  assert.equal(capacityReport(p.receipt,p.observation,p.capture).status,'failed')
  p.observation.count = p.capture.count = p.capture.memory.count = 100000
  assert.equal(capacityReport(p.receipt,p.observation,p.capture).status,'observed-over-target')
  p.capture.crashed = true; assert.throws(() => capacityReport(p.receipt,p.observation,p.capture))
})
test('容量单例预算独立，常用原生与完整 smoke 不暗中增加规模观测',() => {
  assert.equal(selection('--scenario','scale-100000-native',[]).testCaseMs,600000)
  assert.equal(selection('--case','NativeTests/NativeSqliteTests/testIosTextScale',[]).testCaseMs,undefined)
  const full = fs.readFileSync('scripts/lib/ios-app-full.sh','utf8')
  assert.ok(!full.includes('scheme Capacity'))
  assert.ok(!full.includes('testCapacity10000'))
  assert.equal(selection('--case','DictionaryUITests/DictionaryTouchTests/test51IosKeyboardNavigation',[]).fixture,undefined)
  for (const phase of ['prepare','native','pages','cold']) {
    const selected = selection('--scenario','scale-10000-'+phase,[])
    assert.equal(selected.capacityPhase,phase); assert.equal(selected.cases.length,phase === 'cold' ? 5 : 1)
  }
})
test('逐次测试清单绑定 nonce 和绝对产物，不能修改缓存清单或沿用其他轮环境',() => {
  const original = { targets:[{ TestBundlePath:'__TESTROOT__/Tests.xctest',EnvironmentVariables:{ MYBILL_CAPACITY_CONTEXT:'old',other:'keep' } }] }
  const bound = bindScalePlan(original,'/owned/products',{ runId:'new' })
  assert.equal(original.targets[0].TestBundlePath,'__TESTROOT__/Tests.xctest')
  assert.equal(original.targets[0].EnvironmentVariables.MYBILL_CAPACITY_CONTEXT,'old')
  assert.equal(bound.targets[0].TestBundlePath,'/owned/products/Tests.xctest')
  assert.equal(JSON.parse(bound.targets[0].EnvironmentVariables.MYBILL_CAPACITY_CONTEXT).runId,'new')
  assert.equal(bound.targets[0].EnvironmentVariables.other,'keep')
})
test('受管容量安装绑定设备、会话和新旧制品，缺失回执或外部替换均拒绝',() => {
  const session = { context:{ runId:'owner',simulatorId:'device' } }, hash = 'a'.repeat(64)
  const lease = { kind:'capacity',owner:'owner',deviceId:'device',appId:scaleAppId,artifactHash:hash }
  assert.doesNotThrow(() => assertScaleLease(lease,session,hash))
  for (const bad of [undefined,{ ...lease,owner:'other' },{ ...lease,deviceId:'other' },{ ...lease,appId:'com.mybill.offline' },
    { ...lease,artifactHash:undefined }]) assert.throws(() => assertScaleLease(bad,session,hash))
  assert.throws(() => assertScaleLease(lease,session,'b'.repeat(64)))
  assert.throws(() => assertScaleLease({ ...lease,artifactHash:undefined },session,undefined))
})
test('组合 RSS 只归属当前模拟器的唯一 App/WebContent，其他任务和多 WebView 不混入',() => {
  const services = `10 0 UIKitApplication:${scaleAppId}[a][rb-legacy]`
  const processes = `10 2 100 /CoreSimulator/Devices/owned/data/Bundle/App.app/App\n11 2 200 /Runtime/WebContentExtension.appex/com.apple.WebKit.WebContent\n22 3 999 /Other/com.apple.WebKit.WebContent`
  const value = resolveScaleProcesses(services+'\n30 0 UIKitApplication:com.apple.Spotlight[a]\n31 0 UIKitApplication:com.apple.chrono.WidgetRenderer-Default[b]',processes,'owned')
  assert.equal(value.appBytes,102400); assert.equal(value.webBytes,204800); assert.equal(value.webPid,11)
  assert.equal(resolveScaleProcesses(services+'\n30 0 UIKitApplication:com.mybill.offline.CapacityColdTests.xctrunner[a]',processes,'owned').webPid,11)
  assert.equal(resolveScaleProcesses(services,processes,'other'),undefined)
  assert.equal(resolveScaleProcesses(services,processes+'\n23 2 300 /Other/com.apple.WebKit.WebContent','owned'),undefined)
  assert.equal(resolveScaleProcesses(services+'\n20 0 UIKitApplication:other.app[b]',processes,'owned'),undefined)
})
test('夹具摘要、数据集、数量和文件类型在覆盖前只读验证，重复或缺失阶段输出拒绝',t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'capacity-guard-')))
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true }))
  const file = path.join(directory,'fixture.sqlite'), db = new DatabaseSync(file)
  db.exec(`CREATE TABLE ledger_meta(dataset_id TEXT,schema_version INTEGER,initialized INTEGER);
    INSERT INTO ledger_meta VALUES('dataset',9,1);CREATE TABLE ledger_entry(id INTEGER);
    WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000) INSERT INTO ledger_entry SELECT n FROM seq;`)
  db.close()
  const expected = { count:10000,datasetId:'dataset',sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
  assert.doesNotThrow(() => verifyScaleFixture(file,expected))
  for (const bad of [{ ...expected,count:100000 },{ ...expected,datasetId:'other' },{ ...expected,sha256:'f'.repeat(64) }])
    assert.throws(() => verifyScaleFixture(file,bad))
  const link = path.join(directory,'linked'); fs.symlinkSync(file,link)
  assert.throws(() => verifyScaleFixture(link,expected))
  const log = path.join(directory,'test.log')
  fs.writeFileSync(log,'IOS_CAPACITY_PAGES {"runId":"one"}\n')
  assert.equal(readScaleEvent(log,'IOS_CAPACITY_PAGES').runId,'one')
  fs.appendFileSync(log,'IOS_CAPACITY_PAGES {"runId":"old"}\n')
  assert.throws(() => readScaleEvent(log,'IOS_CAPACITY_PAGES'))
})

test('采样结束或落盘失败仍停止隔离 App，保留主失败和全部补偿失败',async () => {
  for (const stage of ['sample','save']) {
    const primary = new Error('primary'), secondary = new Error(stage), stopped = []
    await assert.rejects(finishScale({ failure:primary,
      sampler:{ stop:async () => { if (stage === 'sample') throw secondary; return {} } },
      save:async () => { throw secondary },stop:async () => { stopped.push(true) }
    }),error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === secondary)
    assert.deepEqual(stopped,[true])
  }
  let stopped = false
  await finishScale({ stop:async () => { stopped = true } })
  assert.equal(stopped,true)
})

test('组合内存绑定本轮来源，冷启动真实进程缺席允许，其他窗口缺测拒绝',() => {
  const p = fixture()
  p.capture.memory.samples[0] = { at:0,phase:'launch',appPid:null,webPid:null,appBytes:0,webBytes:0 }
  assert.equal(capacityReport(p.receipt,p.observation,p.capture).status,'passed')
  p.capture.memory.runId = 'other'
  assert.throws(() => capacityReport(p.receipt,p.observation,p.capture),/来源/)
  p.capture.memory.runId = p.receipt.runId
  p.capture.memory.samples[1] = { ...p.capture.memory.samples[0],at:500 }
  assert.throws(() => capacityReport(p.receipt,p.observation,p.capture),/采样/)
})

test('真机内存 MB 按十进制边界判定，不放宽为 MiB',() => {
  const p = fixture()
  for (const sample of p.capture.memory.samples) { sample.appBytes=150000000; sample.webBytes=150000000 }
  assert.equal(capacityReport(p.receipt,p.observation,p.capture).status,'passed')
  p.capture.memory.samples[1].webBytes++
  assert.equal(capacityReport(p.receipt,p.observation,p.capture).status,'failed')
})

test('连续冷启动之间的进程退出窗口可采零值，不扩展到其他操作窗口',() => {
  const p = fixture()
  p.capture.spans.coldStart = Array.from({ length:5 },(_,i) => ({ start:i*2,end:i*2+1 }))
  for (const [key,windows] of Object.entries(p.capture.spans)) if (key !== 'coldStart')
    p.capture.spans[key] = windows.map(w => ({ start:w.start+100,end:w.end+100 }))
  p.capture.memory.samples.splice(1,0,{ at:1.5,phase:'launch',appPid:null,webPid:null,appBytes:0,webBytes:0 })
  assert.equal(capacityReport(p.receipt,p.observation,p.capture).status,'passed')
  p.capture.memory.samples[1].at=20
  assert.throws(() => capacityReport(p.receipt,p.observation,p.capture),/采样/)
})

test('冷启动五单例仅聚合本轮同源样本，缺失、重复和混轮均拒绝',t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'capacity-cold-'))
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true }))
  const file = path.join(directory,'cold.log')
  const events = Array.from({ length:5 },(_,sampleIndex) => ({ runId:'run',count:10000,datasetId:'dataset',
    deviceId:'device',sourceHash:'source',artifactHash:'artifact',mode:'simulator',clockDefinition:'automation-upper-bound',
    sampleIndex,samples:[10+sampleIndex],spans:[{ start:1000+sampleIndex*100,end:1010+sampleIndex*101 }] }))
  const write = values => fs.writeFileSync(file,values.map(value => 'IOS_CAPACITY_COLD_SAMPLE '+JSON.stringify(value)).join('\n'))
  write(events.toReversed()); assert.deepEqual(readScaleCold(file).samples,[10,11,12,13,14])
  assert.equal(selection('--scenario','scale-10000',[]).cases.length,8)
  for (const mutate of [xs => xs.pop(),xs => xs.push(xs[0]),xs => xs[4].sampleIndex=0,
    ...['runId','datasetId','deviceId','sourceHash','artifactHash','mode','clockDefinition','count'].map(key => xs => xs[4][key]='other'),
    xs => xs[4].spans[0].end+=2,xs => xs[4].samples=[NaN]]) {
    const values = structuredClone(events); mutate(values); write(values)
    assert.throws(() => readScaleCold(file),/五份有效样本/)
  }
})

test('模拟器报告同样拒绝跨轮、跨制品或非隔离来源，不能误记开发观测',() => {
  for (const change of [p => p.observation.runId='00000000-0000-4000-8000-000000000002',
    p => p.observation.sourceHash='f'.repeat(64),p => p.observation.artifactHash='f'.repeat(64),
    p => p.receipt.appId='com.mybill.offline',p => p.receipt.count=100000]) {
    const p = fixture(); p.receipt.mode='simulator'; change(p)
    assert.throws(() => capacityReport(p.receipt,p.observation),/来源、隔离/)
  }
})
