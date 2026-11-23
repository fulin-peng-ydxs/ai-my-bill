import fs from 'node:fs'
import path from 'node:path'
import { randomUUID,createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { hashPaths,capacityColdCases } from './ios-debug.mjs'
import { assertOwnedContainer,contentHash } from './ios-cache.mjs'
import { scaleAppId,capacityReport } from './ios-capacity.mjs'
import { runCommand } from './ios-ci-run.mjs'

export function readScaleEvent(file,label) {
  const lines = [...fs.readFileSync(file,'utf8').matchAll(new RegExp('^'+label+' (\\{[^\\r\\n]*\\})$','gm'))]
  if (lines.length !== 1) throw new Error('容量输出缺失或混入多轮：'+label)
  return JSON.parse(lines[0][1])
}
/** 同一会话的五个独立用例；缺样本、重复或跨轮输出均不拼接成通过。 */
export function readScaleCold(file) {
  const events = [...fs.readFileSync(file,'utf8').matchAll(/^IOS_CAPACITY_COLD_SAMPLE (\{[^\r\n]*\})$/gm)]
    .map(value => JSON.parse(value[1]))
  const keys = ['runId','count','datasetId','deviceId','sourceHash','artifactHash','mode','clockDefinition']
  if (events.length !== 5 || new Set(events.map(x => x.sampleIndex)).size !== 5 || events.some(x =>
    !Number.isInteger(x.sampleIndex) || x.sampleIndex < 0 || x.sampleIndex > 4 ||
    keys.some(key => x[key] === undefined || x[key] !== events[0][key]) ||
    x.samples?.length !== 1 || !Number.isFinite(x.samples[0]) || x.samples[0] <= 0 ||
    x.spans?.length !== 1 || !Number.isFinite(x.spans[0].start) || !Number.isFinite(x.spans[0].end) ||
    Math.abs(x.spans[0].end-x.spans[0].start-x.samples[0]) > 1))
    throw new Error('冷启动必须包含本轮同源、无重复的五份有效样本。')
  events.sort((a,b) => a.sampleIndex-b.sampleIndex)
  const { sampleIndex,samples,spans,...header } = events[0]
  return { ...header,samples:events.flatMap(x => x.samples),spans:events.flatMap(x => x.spans) }
}
export function bindScalePlan(value,products,context) {
  if (typeof value === 'string') return value.replaceAll('__TESTROOT__',products)
  if (Array.isArray(value)) return value.map(x => bindScalePlan(x,products,context))
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([k,v]) => [k,bindScalePlan(v,products,context)]))
  if (result.TestBundlePath) result.EnvironmentVariables = { ...result.EnvironmentVariables,MYBILL_CAPACITY_CONTEXT:JSON.stringify(context) }
  return result
}
export function verifyScaleFixture(source,expected) {
  if (fs.realpathSync(source) !== source || !fs.lstatSync(source).isFile() || fs.statSync(source).size > 256*1024*1024)
    throw new Error('容量夹具路径或大小无效。')
  const sha = createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  if (sha !== expected.sha256) throw new Error('容量夹具摘要不符。')
  const database = new DatabaseSync(source,{ readOnly:true })
  try {
    const meta = database.prepare('SELECT dataset_id,schema_version FROM ledger_meta WHERE initialized=1').get()
    if (meta?.dataset_id !== expected.datasetId || meta.schema_version !== 9 ||
        database.prepare('SELECT count(*) AS n FROM ledger_entry').get().n !== expected.count ||
        database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || database.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('容量夹具结构、数据集、规模或完整性不符。')
  } finally { database.close() }
}
const swapFile = directory => path.join(directory,'ledgerSQLite.db.capacity-intent.json')
const swapTarget = directory => path.join(directory,'ledgerSQLite.db')
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)

/** 只认当前受管沙盒内的精确操作登记；不按文件名前缀猜测归属。 */
export function recoverScaleSwap(directory,identity,io = fs) {
  if (identity.appId !== scaleAppId || !uuid(identity.owner) || !uuid(identity.deviceId))
    throw new Error('容量换库归属无效。')
  try {
    if (fs.realpathSync(directory) !== directory) throw new Error('容量换库目录无效。')
  } catch (error) { if (error.code === 'ENOENT') return; throw error }
  const journal = swapFile(directory)
  let stat
  try { stat = io.lstatSync(journal) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 4096)
    throw new Error('容量换库登记类型或权限无效。')
  const value = JSON.parse(io.readFileSync(journal,'utf8'))
  if (value.schema !== 1 || !uuid(value.runId) ||
      ['owner','deviceId','appId'].some(key => value[key] !== identity[key]) ||
      Object.keys(value).sort().join(',') !== 'appId,deviceId,owner,runId,schema')
    throw new Error('容量换库登记归属不符。')
  const staged = swapTarget(directory)+'.capacity-'+value.runId
  let copy
  try { copy = io.lstatSync(staged) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (copy && (!copy.isFile() || copy.nlink !== 1)) throw new Error('容量换库暂存文件类型无效。')
  // rename 是提交点。暂存已不存在时只清登记，不回滚已替换的主库。
  if (copy) io.unlinkSync(staged)
  io.unlinkSync(journal)
}

/** 原子覆盖前保留原库；失败补偿与下次中断恢复共用同一有界清理。 */
export function replaceScaleFixture(directory,source,fixture,identity,io = fs) {
  recoverScaleSwap(directory,identity,io)
  verifyScaleFixture(source,fixture)
  const target = swapTarget(directory)
  const targetStat = fs.lstatSync(target)
  if (!targetStat.isFile() || targetStat.nlink !== 1 ||
      ['-wal','-shm','-journal'].some(suffix => fs.existsSync(target+suffix)))
    throw new Error('容量换库目标或旁路文件不安全。')
  const runId = randomUUID(), staged = target+'.capacity-'+runId
  // 先登记再复制；登记失败不会产生大型副本。后续仅删除本次精确路径。
  let failure, created = false, registered = false
  try {
    const fd = io.openSync(swapFile(directory),'wx',0o600)
    created = true
    try { io.writeFileSync(fd,JSON.stringify({ schema:1,...identity,runId })) }
    finally { io.closeSync(fd) }
    registered = true
    io.copyFileSync(source,staged,fs.constants.COPYFILE_EXCL)
    io.chmodSync(staged,0o600)
    verifyScaleFixture(staged,fixture)
    io.renameSync(staged,target)
  } catch (error) { failure = error; throw error }
  finally {
    try {
      if (registered) recoverScaleSwap(directory,identity,io)
      else if (created) io.unlinkSync(swapFile(directory))
    } catch (error) { throw new AggregateError(failure ? [failure,error] : [error],'容量换库清理失败，保留登记供重试。') }
  }
}
export function assertScaleLease(lease,session,installedHash) {
  if (!lease || lease.kind !== 'capacity' || lease.owner !== session.context.runId || lease.deviceId !== session.context.simulatorId ||
      lease.appId !== scaleAppId || !/^[a-f0-9]{64}$/.test(installedHash ?? '') ||
      !/^[a-f0-9]{64}$/.test(lease.artifactHash ?? '') || ![lease.artifactHash,lease.previousHash].includes(installedHash))
    throw new Error('容量 App 非本轮受管安装或制品发生变化，拒绝接管和换库。')
}

export function resolveScaleProcesses(services,processes,simulatorId) {
  const apps = [...services.matchAll(/^(\d+)\s+\S+\s+UIKitApplication:([^\[\s]+)\[/gm)]
  const subjects = apps.filter(item => !item[2].startsWith('com.apple.') && item[2] !== 'com.mybill.offline.CapacityColdTests.xctrunner')
  if (subjects.length !== 1 || subjects[0][2] !== scaleAppId) return undefined
  const rows = processes.split('\n').map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(m => ({ pid:Number(m[1]),parent:Number(m[2]),bytes:Number(m[3])*1024,command:m[4] }))
  const app = rows.find(row => row.pid === Number(subjects[0][1]) && row.command.includes('/'+simulatorId+'/') && row.command.endsWith('/App.app/App'))
  if (!app || app.bytes <= 0) return undefined
  const views = rows.filter(row => row.parent === app.parent && row.command.endsWith('/com.apple.WebKit.WebContent'))
  if (views.length !== 1 || views[0].bytes <= 0) return undefined
  return { at:Date.now(),appPid:app.pid,webPid:views[0].pid,appBytes:app.bytes,webBytes:views[0].bytes }
}

function sampleMemory(root,run,sim) {
  let stopped = false,serial = 0
  const samples = [], unavailable = []
  const loop = (async () => {
    while (!stopped) {
      const serviceLog = path.join(run,`rss-services-${serial}.log`), psLog = path.join(run,`rss-ps-${serial++}.log`)
      try {
        await runCommand(root,'xcrun',['simctl','spawn',sim,'launchctl','list'],serviceLog,3000)
        await runCommand(root,'/bin/ps',['-A','-o','pid=,ppid=,rss=,comm='],psLog,3000)
        const value = resolveScaleProcesses(fs.readFileSync(serviceLog,'utf8'),fs.readFileSync(psLog,'utf8'),sim)
        if (value) samples.push(value)
        else unavailable.push({ at:Date.now(),reason:'no-unique-active-app-web-process-pair' })
      } catch (error) { unavailable.push({ at:Date.now(),reason:error.message }) }
      finally { for (const file of [serviceLog,psLog]) fs.rmSync(file,{ force:true }) }
      if (!stopped) await new Promise(resolve => setTimeout(resolve,500))
    }
  })()
  return { async stop() {
    stopped = true; await loop
    return { scope:'isolated-simulator-active-process-rss-observation',samples,unavailable,
      peakBytes:samples.length ? Math.max(...samples.map(x => x.appBytes+x.webBytes)) : null,
      deviceAcceptance:'not-verified' }
  } }
}

/** 每项补偿独立执行；日志或采样失败不能跳过停止自己创建的 App。 */
export async function finishScale({ sampler, save, stop, failure }) {
  const errors = []
  if (sampler) {
    try { await save(await sampler.stop()) } catch (error) { errors.push(error) }
  }
  try { await stop() } catch (error) { errors.push(error) }
  if (errors.length) throw new AggregateError(failure ? [failure,...errors] : errors,'容量测试补偿失败。')
}

/** 共享既有锁、阶段时钟、进程清理和分层构建；只新增独立 Bundle 的规模场景。 */
export async function runScaleSimulator({ root,run,session,selected,toolchain,command,tracked,prepareBuild }) {
  const build = await prepareBuild(session,selected,run,toolchain)
  const app = path.join(build.products,'Release-iphonesimulator/App.app')
  const artifactHash = hashPaths(app,['.'])
  const sim = session.context.simulatorId
  const container = async kind => (await command('xcrun',['simctl','get_app_container',sim,scaleAppId,kind])).text.trim()
  const leaseFile = path.join(session.directory,'capacity-owner.json')
  const found = await tracked(run,'install',['capacity/install-inspection'],'xcrun',
    ['simctl','get_app_container',sim,scaleAppId,'app'],{ accept:[0,2],log:path.join(run,'capacity-inspect.log') })
  if (found.status === 2 && !/domain=NSPOSIXErrorDomain, code=2/.test(fs.readFileSync(path.join(run,'capacity-inspect.log'),'utf8')))
    throw new Error('容量 App 安装状态读取失败，不能当作未安装。')
  let previousHash
  if (found.status === 0) {
    previousHash = hashPaths(fs.readFileSync(path.join(run,'capacity-inspect.log'),'utf8').trim(),['.'])
    assertScaleLease(fs.existsSync(leaseFile) ? JSON.parse(fs.readFileSync(leaseFile,'utf8')) : undefined,session,previousHash)
  }
  const lease = { kind:'capacity',owner:session.context.runId,deviceId:sim,appId:scaleAppId,artifactHash,previousHash }
  fs.writeFileSync(leaseFile,JSON.stringify(lease),{ mode:0o600 })
  if (previousHash !== artifactHash) await tracked(run,'install',['capacity/install'],'xcrun',
    ['simctl','install',sim,app],{ log:path.join(run,'capacity-install.log') })
  const context = { runId:randomUUID(),mode:'simulator',deviceId:sim,count:selected.capacity,sourceHash:build.sourceHash,artifactHash }
  fs.writeFileSync(path.join(run,'capacity-context.json'),JSON.stringify(context),{ mode:0o600 })
  const original = JSON.parse((await command('plutil',['-convert','json','-o','-',build.plan])).text)
  const execute = async (name,log,budget) => {
    const manifestJson = log+'.plan.json', manifest = log+'.xctestrun'
    fs.writeFileSync(manifestJson,JSON.stringify(bindScalePlan(original,build.products,context)),{ mode:0o600 })
    await command('plutil',['-convert','xml1','-o',manifest,manifestJson])
    const cases = Array.isArray(name) ? name : [name]
    return tracked(run,'test',cases.map(value => 'case/'+value),'xcodebuild',[
    'test-without-building','-xctestrun',manifest,'-destination',`platform=iOS Simulator,id=${sim}`,
    '-parallel-testing-enabled','NO','-test-timeouts-enabled','YES','-maximum-test-execution-time-allowance',String(budget),
    '-collect-test-diagnostics','never',...cases.map(value => '-only-testing:'+value),'-resultBundlePath',path.join(run,path.basename(log,'.log')+'.xcresult')
    ],{ log,testCaseMs:budget*1000 })
  }
  const stop = async label => {
    const log = path.join(run,label+'.log')
    if (label === 'capacity-stop-final') {
      // 补偿复用统一进程清理，允许在执行已取消后有界结束自己创建的隔离 App。
      try { await runCommand(root,'xcrun',['simctl','terminate',sim,scaleAppId],log,10_000) }
      catch (error) {
        if (!/exit=3\b/.test(error.message) || !fs.readFileSync(log,'utf8').includes('found nothing to terminate')) throw error
      }
      return
    }
    const result = await command('xcrun',['simctl','terminate',sim,scaleAppId],{ accept:[0,3],log })
    if (result.status === 3 && !fs.readFileSync(log,'utf8').includes('found nothing to terminate')) throw new Error('容量 App 未可靠停止。')
  }
  const checkInstalled = async () => {
    const installed = await container('app'), actualHash = hashPaths(installed,['.'])
    if (actualHash !== artifactHash) throw new Error('容量测试安装的制品与构建不符。')
    assertScaleLease(JSON.parse(fs.readFileSync(leaseFile,'utf8')),session,actualHash)
    const data = await container('data'); assertOwnedContainer(session.context,data); return data
  }
  let failure, sampler, memory
  try {
    const stopMain = await command('xcrun',['simctl','terminate',sim,'com.mybill.offline'],{ accept:[0,3],log:path.join(run,'capacity-stop-main.log') })
    if (stopMain.status === 3 && !fs.readFileSync(path.join(run,'capacity-stop-main.log'),'utf8').includes('found nothing to terminate')) throw new Error('同轮主 App 未可靠停止。')
    const identity = { owner:session.context.runId,deviceId:sim,appId:scaleAppId }
    await stop('capacity-stop-before-recovery')
    const initialData = await checkInstalled()
    recoverScaleSwap(path.join(initialData,'Library/OfflineLedger'),identity)
    const phase = selected.capacityPhase
    const wants = name => phase === 'all' || phase === name
    const fixtureState = path.join(session.directory,`capacity-fixture-${selected.capacity}.json`)
    const compatibility = contentHash(root,['app/test-support/capacityScenario.ts','app/test-support/entryScenarios.ts',
      'app/src/data/entries','app/src/data/migrations','app/src/data/seed','app/src/domain'])
    let fixture, native, pages, cold
    if (wants('prepare')) {
      const fixtureLog = path.join(run,'capacity-prepare.log')
      await execute('CapacityTests/CapacityTests/testPrepareCapacityFixture',fixtureLog,60)
      await stop('capacity-stop-prepare')
      fixture = readScaleEvent(fixtureLog,'IOS_CAPACITY_FIXTURE')
      if (fixture.runId !== context.runId || fixture.count !== selected.capacity || fixture.sourceHash !== build.sourceHash ||
          fixture.artifactHash !== artifactHash || fixture.fixturePath !== `Library/Capacity/${context.runId}/fixture.sqlite`)
        throw new Error('容量夹具回执归属不符。')
      const data = await checkInstalled()
      verifyScaleFixture(path.join(data,fixture.fixturePath),fixture)
      fs.writeFileSync(fixtureState,JSON.stringify({ owner:session.context.runId,compatibility,fixture }),{ mode:0o600 })
    } else if (wants('pages') || wants('cold')) {
      const previous = JSON.parse(fs.readFileSync(fixtureState,'utf8'))
      if (previous.owner !== session.context.runId || previous.compatibility !== compatibility || previous.fixture?.count !== selected.capacity)
        throw new Error('容量夹具来源已变化，先局部运行相同规模的 -prepare。')
      fixture = previous.fixture
    }
    const restoreFixture = async label => {
      await stop(label)
      const data = await checkInstalled(), source = path.join(data,fixture.fixturePath)
      replaceScaleFixture(path.join(data,'Library/OfflineLedger'),source,fixture,identity)
      context.datasetId = fixture.datasetId
    }
    if (phase !== 'prepare') sampler = sampleMemory(root,run,sim)
    if (wants('native')) {
      const log = path.join(run,'capacity-native.log')
      await execute('CapacityTests/CapacityTests/testNativeCapacity',log,600)
      await stop('capacity-stop-native'); native = readScaleEvent(log,'IOS_CAPACITY_OBSERVATION')
    }
    if (wants('pages')) {
      await restoreFixture('capacity-stop-before-pages')
      const log = path.join(run,'capacity-pages.log')
      await execute('CapacityTests/CapacityTests/testPageCapacity',log,600)
      await stop('capacity-stop-pages'); pages = readScaleEvent(log,'IOS_CAPACITY_PAGES')
    }
    if (wants('cold')) {
      await restoreFixture('capacity-stop-before-cold')
      const log = path.join(run,'capacity-cold.log')
      await execute(capacityColdCases,log,60)
      cold = readScaleCold(log)
    }
    if (sampler) {
      memory = await sampler.stop(); sampler = undefined
      if (memory.samples.length < 2) {
        fs.writeFileSync(path.join(run,'capacity-memory-partial.json'),JSON.stringify(memory),{ flag:'wx',mode:0o600 })
        throw new Error('未采到独立模拟器的 App/WKWebView 组合内存。')
      }
    }
    for (const value of [native,pages,cold].filter(Boolean)) if (value.runId !== context.runId || value.sourceHash !== context.sourceHash ||
      value.artifactHash !== artifactHash || value.count !== selected.capacity) throw new Error('容量阶段证据不属于同一运行和制品。')
    if (pages || cold) {
      const currentData = await checkInstalled()
      const db = new DatabaseSync(path.join(currentData,'Library/OfflineLedger/ledgerSQLite.db'),{ readOnly:true })
      try {
        if (db.prepare('SELECT count(*) AS n FROM ledger_entry').get().n !== selected.capacity ||
            db.prepare('SELECT dataset_id FROM ledger_meta').get().dataset_id !== fixture.datasetId) throw new Error('容量冷热阶段丢失夹具或数据集发生变化。')
      } finally { db.close() }
    }
    const receipt = { ...context,appId:scaleAppId,configuration:'Release',debugger:false,
      workingTree:execFileSync('git',['status','--porcelain=v1','--untracked-files=normal'],{ cwd:root,encoding:'utf8' }).trim().length > 0,
      commit:execFileSync('git',['rev-parse','HEAD'],{ cwd:root,encoding:'utf8' }).trim(),environment:JSON.parse(toolchain) }
    const report = { ...(native ? capacityReport(receipt,native) : { schema:1,status:'observed-partial',deviceAcceptance:'not-verified',receipt }),
      phase,pages,cold,memory,fixtureReceipt:fixture,
      missingDeviceEvidence:['physical-device','full-window-combined-memory','hardware-accessibility'] }
    fs.writeFileSync(path.join(run,'capacity-report.json'),JSON.stringify(report,null,2)+'\n',{ flag:'wx',mode:0o600 })
    return { sourceHash:build.sourceHash,cacheHit:build.cacheHit,buildLayers:build.buildLayers,capacityReport:path.join(run,'capacity-report.json') }
  } catch (error) { failure = error; throw error }
  finally {
    await finishScale({ sampler, failure,
      save: partial => fs.writeFileSync(path.join(run,'capacity-memory-partial.json'),JSON.stringify(partial),{ flag:'wx',mode:0o600 }),
      stop: () => stop('capacity-stop-final') })
  }
}
