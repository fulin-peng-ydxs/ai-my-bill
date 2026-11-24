import { capacityEvidenceFixture as fixture } from '../fixtures/capacity-report.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash,randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { runCommand } from '../lib/ios-ci-run.mjs'
import { capacityReport,scaleAppId,scaleMetrics,percentile95 } from '../lib/ios-capacity.mjs'
import { selection } from '../lib/ios-debug.mjs'
import { bindScalePlan,verifyScaleFixture,assertScaleLease,resolveScaleProcesses,readScaleEvent,readScaleCold,finishScale,replaceScaleFixture,recoverScaleSwap } from '../lib/ios-scale-run.mjs'
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
  assert.equal(original.targets[0].DiagnosticCollectionPolicy,undefined)
  assert.equal(bound.targets[0].DiagnosticCollectionPolicy,0)
  const ui = { targets:[{ TestBundlePath:'__TESTROOT__/Cold.xctest',IsUITestBundle:true,PreferredScreenCaptureFormat:'screenRecording' }] }
  assert.equal(bindScalePlan(ui,'/owned/products',{}).targets[0].PreferredScreenCaptureFormat,'screenshots')
  assert.equal(ui.targets[0].PreferredScreenCaptureFormat,'screenRecording')
  assert.equal(bound.targets[0].PreferredScreenCaptureFormat,undefined)
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

test('容量收尾只接纳真实已停止终态，其他退出和超时仍失败',async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'scale-stop-'))
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}))
  const acceptExit = (code,output) => code === 0 || (code === 3 && output.includes('found nothing to terminate'))
  const invoke = (name,code,timeout=10000) => runCommand(process.cwd(),process.execPath,['-e',code],path.join(directory,name+'.log'),timeout,{acceptExit})
  assert.match(await invoke('stopped',"console.log('found nothing to terminate');process.exit(3)"),/found nothing/)
  await assert.rejects(invoke('wrong-error',"console.log('device unavailable');process.exit(3)"),/exit=3/)
  await assert.rejects(invoke('wrong-exit',"console.log('found nothing to terminate');process.exit(2)"),/exit=2/)
  await assert.rejects(invoke('timeout',"console.log('found nothing to terminate');setInterval(()=>{},1000)",200),/失败或取消/)
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
  write([events[1]])
  const single=selection('--scenario','scale-10000-cold-02',[])
  assert.deepEqual(single.cases,['CapacityColdTests/CapacityColdTests/testColdLaunch02'])
  assert.deepEqual(single.capacityColdIndices,[1])
  assert.equal(single.testCaseMs,60000)
  assert.deepEqual(readScaleCold(file,single.capacityColdIndices).samples,[11])
  assert.deepEqual(readScaleCold(file,single.capacityColdIndices).sampleIndices,[1])
  assert.throws(()=>readScaleCold(file),/五份有效样本/)
  assert.throws(()=>readScaleCold(file,[0]),/有效样本/)
  assert.throws(()=>readScaleCold(file,[]),/选择无效/)
  assert.throws(()=>readScaleCold(file,[1,1]),/选择无效/)
  for(const name of ['scale-10000-cold-00','scale-10000-cold-06','scale-10000-native-02'])
    assert.throws(()=>selection('--scenario',name,[]),/未知用例/)

  const short = structuredClone(events)
  short[0].samples=[0.5]
  short[0].spans[0].end=short[0].spans[0].start+0.5
  write(short)
  assert.equal(readScaleCold(file).samples[0],0.5)
  write([short[0]])
  assert.equal(readScaleCold(file,[0]).samples[0],0.5)
  for(const duration of [0,-0.25]) {
    const invalid=structuredClone(short)
    invalid[0].spans[0].end=invalid[0].spans[0].start+duration
    write(invalid)
    assert.throws(()=>readScaleCold(file),/有效样本/)
    write([invalid[0]])
    assert.throws(()=>readScaleCold(file,[0]),/有效样本/)
  }

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

function swapFixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'capacity-swap-')))
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true }))
  const source = path.join(directory,'fixture.sqlite'), target = path.join(directory,'ledgerSQLite.db')
  const db = new DatabaseSync(source)
  db.exec(`CREATE TABLE ledger_meta(dataset_id TEXT,schema_version INTEGER,initialized INTEGER);
    INSERT INTO ledger_meta VALUES('replacement',9,1);CREATE TABLE ledger_entry(id INTEGER);
    WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10000) INSERT INTO ledger_entry SELECT n FROM seq;`)
  db.close()
  fs.copyFileSync(source,target)
  const old = new DatabaseSync(target); old.exec("UPDATE ledger_meta SET dataset_id='original'"); old.close()
  return { directory,source,target,before:fs.readFileSync(target),
    journal:path.join(directory,'ledgerSQLite.db.capacity-intent.json'),
    fixture:{ count:10000,datasetId:'replacement',sha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex') },
    identity:{ owner:randomUUID(),deviceId:randomUUID(),appId:scaleAppId } }
}

test('容量换库登记、复制、权限、校验或提交失败清理副本并保留原库，清理失败保留双重原因与可重试登记',t => {
  for (const stage of ['register','publish','copy','chmod','verify','rename','cleanup']) {
    const p = swapFixture(t), io = { ...fs }, primary = new Error(stage)
    if (stage === 'register') io.writeFileSync = fd => { fs.writeFileSync(fd,'partial'); throw primary }
    if (stage === 'copy') io.copyFileSync = (...args) => { fs.copyFileSync(...args); throw primary }
    if (stage === 'chmod') io.chmodSync = () => { throw primary }
    if (stage === 'verify') io.chmodSync = file => fs.appendFileSync(file,'corrupt')
    if (['publish','rename','cleanup'].includes(stage)) io.renameSync = (from,to) => {
      if (to === (stage === 'publish' ? p.journal : p.target)) throw primary
      fs.renameSync(from,to)
    }
    if (stage === 'cleanup') io.unlinkSync = () => { throw new Error('cleanup blocked') }
    assert.throws(() => replaceScaleFixture(p.directory,p.source,p.fixture,p.identity,io),error => {
      if (stage === 'cleanup') return error instanceof AggregateError && error.errors[0] === primary && /cleanup blocked/.test(error.errors[1].message)
      return stage === 'verify' ? /摘要/.test(error.message) : error === primary
    })
    assert.deepEqual(fs.readFileSync(p.target),p.before)
    assert.equal(fs.existsSync(p.journal),stage === 'cleanup')
    recoverScaleSwap(p.directory,p.identity)
    assert.deepEqual(fs.readdirSync(p.directory).sort(),['fixture.sqlite','ledgerSQLite.db'])
    replaceScaleFixture(p.directory,p.source,p.fixture,p.identity)
    assert.deepEqual(fs.readFileSync(p.target),fs.readFileSync(p.source))
    assert.equal(fs.statSync(p.target).mode & 0o777,0o600)
  }
})

test('容量换库真实进程在登记后、复制后、提交后被强杀，下轮仅清本操作且可连续恢复',t => {
  for (const point of ['registered','copied','committed']) {
    const p = swapFixture(t), other = path.join(p.directory,'ledgerSQLite.db.capacity-'+randomUUID())
    fs.writeFileSync(other,'other task')
    const code = `import fs from 'node:fs';import {replaceScaleFixture} from ${JSON.stringify(new URL('../lib/ios-scale-run.mjs',import.meta.url).href)};
      const p=JSON.parse(process.argv[1]),io={...fs};
      const kill=()=>process.kill(process.pid,'SIGKILL');
      if(p.point==='registered') io.copyFileSync=()=>kill();
      if(p.point==='copied') io.chmodSync=()=>kill();
      if(p.point==='committed') io.renameSync=(from,to)=>{fs.renameSync(from,to);if(to===p.target)kill()};
      replaceScaleFixture(p.directory,p.source,p.fixture,p.identity,io);`
    const child = spawnSync(process.execPath,['--input-type=module','-e',code,JSON.stringify({ ...p,before:undefined,point })],{ timeout:5000,encoding:'utf8' })
    assert.equal(child.signal,'SIGKILL',child.stderr)
    assert.equal(fs.existsSync(p.journal),true)
    const expected = point === 'committed' ? fs.readFileSync(p.source) : p.before
    recoverScaleSwap(p.directory,p.identity); recoverScaleSwap(p.directory,p.identity)
    assert.deepEqual(fs.readFileSync(p.target),expected)
    assert.equal(fs.readFileSync(other,'utf8'),'other task')
    assert.deepEqual(fs.readdirSync(p.directory).sort(),['fixture.sqlite','ledgerSQLite.db',path.basename(other)])
    replaceScaleFixture(p.directory,p.source,p.fixture,p.identity)
    assert.deepEqual(fs.readFileSync(p.target),fs.readFileSync(p.source))
  }
})

test('容量换库恢复拒绝跨会话、设备、错误登记和链接，缺目录及合法重试不误拦',t => {
  const p = swapFixture(t), runId = randomUUID(), staged = p.target+'.capacity-'+runId
  assert.doesNotThrow(() => recoverScaleSwap(path.join(p.directory,'not-created'),p.identity))
  fs.writeFileSync(staged,'partial')
  const write = value => fs.writeFileSync(p.journal,JSON.stringify(value),{ mode:0o600 })
  const receipt = { schema:1,...p.identity,runId }
  for (const value of [{ ...receipt,owner:randomUUID() },{ ...receipt,deviceId:randomUUID() },
    { ...receipt,appId:'com.mybill.offline' },{ ...receipt,runId:'../outside' }]) {
    write(value); assert.throws(() => recoverScaleSwap(p.directory,p.identity))
    assert.equal(fs.readFileSync(staged,'utf8'),'partial'); assert.deepEqual(fs.readFileSync(p.target),p.before)
  }
  write(receipt); fs.unlinkSync(staged); fs.symlinkSync(p.source,staged)
  assert.throws(() => recoverScaleSwap(p.directory,p.identity),/类型/)
  assert.equal(fs.lstatSync(staged).isSymbolicLink(),true)
  fs.unlinkSync(staged); recoverScaleSwap(p.directory,p.identity)
  fs.symlinkSync(p.source,p.journal)
  assert.throws(() => recoverScaleSwap(p.directory,p.identity),/类型/)
  assert.deepEqual(fs.readFileSync(p.target),p.before)
})


test('容量登记创建后写入前强杀、半写入强杀或发布前后中断均可恢复',t => {
  for (const point of ['before-write','partial-write','before-publish','after-publish']) {
    const p = swapFixture(t)
    const code = `import fs from 'node:fs';import {replaceScaleFixture} from ${JSON.stringify(new URL('../lib/ios-scale-run.mjs',import.meta.url).href)};
      const p=JSON.parse(process.argv[1]),io={...fs},kill=()=>process.kill(process.pid,'SIGKILL');
      if(p.point==='before-write') io.writeFileSync=()=>kill();
      if(p.point==='partial-write') io.writeFileSync=fd=>{fs.writeFileSync(fd,'partial');kill()};
      io.renameSync=(from,to)=>{
        if(to===p.journal && p.point==='before-publish') kill();
        fs.renameSync(from,to);
        if(to===p.journal && p.point==='after-publish') kill();
      };
      replaceScaleFixture(p.directory,p.source,p.fixture,p.identity,io);`
    const child = spawnSync(process.execPath,['--input-type=module','-e',code,JSON.stringify({ ...p,before:undefined,point })],{ timeout:5000,encoding:'utf8' })
    assert.equal(child.signal,'SIGKILL',child.stderr)
    assert.equal(fs.existsSync(p.journal),point==='after-publish','正式登记只允许完整发布')
    assert.deepEqual(fs.readFileSync(p.target),p.before)
    recoverScaleSwap(p.directory,p.identity); recoverScaleSwap(p.directory,p.identity)
    assert.deepEqual(fs.readdirSync(p.directory).sort(),['fixture.sqlite','ledgerSQLite.db'])
    replaceScaleFixture(p.directory,p.source,p.fixture,p.identity)
    assert.deepEqual(fs.readFileSync(p.target),fs.readFileSync(p.source))
  }
})

test('容量登记部分写入失败且清理失败仍保留主失败，下次重试只清本会话临时登记',t => {
  const p = swapFixture(t), primary = new Error('partial write'), cleanup = new Error('cleanup unavailable')
  const other = path.join(p.directory,`ledgerSQLite.db.capacity-intent-${randomUUID()}-${p.identity.deviceId}.tmp`)
  fs.writeFileSync(other,'other task')
  assert.throws(() => replaceScaleFixture(p.directory,p.source,p.fixture,p.identity,{ ...fs,
    writeFileSync:fd => { fs.writeFileSync(fd,'partial'); throw primary },
    unlinkSync:() => { throw cleanup }
  }),error => error instanceof AggregateError && error.errors[0]===primary && error.errors[1]===cleanup)
  assert.equal(fs.existsSync(p.journal),false)
  assert.deepEqual(fs.readFileSync(p.target),p.before)
  recoverScaleSwap(p.directory,p.identity)
  assert.equal(fs.readFileSync(other,'utf8'),'other task')
  assert.deepEqual(fs.readdirSync(p.directory).sort(),['fixture.sqlite','ledgerSQLite.db',path.basename(other)])
  replaceScaleFixture(p.directory,p.source,p.fixture,p.identity)
  assert.deepEqual(fs.readFileSync(p.target),fs.readFileSync(p.source))
})

test('容量登记临时路径拒绝链接、宽权限和超限文件，非法正式登记不被自动清空',t => {
  const p = swapFixture(t)
  const temporary = path.join(p.directory,`ledgerSQLite.db.capacity-intent-${p.identity.owner}-${p.identity.deviceId}.tmp`)
  for (const kind of ['symlink','hardlink','permissions','oversize','invalid-journal']) {
    if (kind==='symlink') fs.symlinkSync(p.source,temporary)
    else if (kind==='hardlink') fs.linkSync(p.source,temporary)
    else fs.writeFileSync(temporary,kind==='oversize' ? 'x'.repeat(4097) : 'partial',{mode:0o600})
    if (kind==='permissions') fs.chmodSync(temporary,0o644)
    if (kind==='invalid-journal') fs.writeFileSync(p.journal,'partial',{mode:0o600})
    assert.throws(() => recoverScaleSwap(p.directory,p.identity),kind==='invalid-journal' ? SyntaxError : /临时登记/)
    assert.equal(fs.lstatSync(temporary).isSymbolicLink(),kind==='symlink')
    assert.deepEqual(fs.readFileSync(p.target),p.before)
    fs.unlinkSync(temporary)
    if (kind==='invalid-journal') { assert.equal(fs.readFileSync(p.journal,'utf8'),'partial'); fs.unlinkSync(p.journal) }
  }
})
