import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { spawn, spawnSync } from 'node:child_process'
import { swiftCaseInput } from '../lib/ios-execution-inputs.mjs'
import {
  APP_ID,
  RUNTIME,
  DEVICE_TYPE,
  uiCases,
  selection,
  keyboardReadyScenario,
  incomeNoteScenario,
  incomeNoteAfterSaveScenario,
  readSession,
  needsSimulatorRecovery,
  assertDevice,
  hashPaths,
  sourceHash
} from '../lib/ios-debug.mjs'

function temporary(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-debug-test-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
function cliProject(t) {
  const root = temporary(t)
  for (const file of [
    'scripts/ios-app.mjs',
    'scripts/lib',
    'app/native-tests/scenarios.json'
  ]) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(new URL('../../' + file, import.meta.url), target, { recursive: true })
  }
  return root
}
test('后续准备失败不遮蔽历史自动化失败，成功测试才解除设备恢复需求', async t => {
  const root = temporary(t)
  const add = async (name, status, tested) => {
    // 显式区分创建顺序，不以测试耗时作为行为判据。
    await new Promise(resolve => setTimeout(resolve, 5))
    const run = path.join(root, 'run-' + name)
    fs.mkdirSync(run)
    if (tested) fs.writeFileSync(path.join(run, 'test.log'), 'controlled test execution')
    if (status) fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify({ status }))
  }
  assert.equal(needsSimulatorRecovery(root), false)
  await add('OldTest', 'failed', true)
  for (const name of ['Build', 'Install', 'Initialize']) {
    await add(name, 'failed', false)
    assert.equal(needsSimulatorRecovery(root), true, name + ' 不得遮住旧失败')
  }
  await add('Passed', 'passed', true)
  assert.equal(needsSimulatorRecovery(root), false)
  await add('Unfinished', undefined, true)
  assert.equal(needsSimulatorRecovery(root), true, '未写完回执仍需恢复')
})
test('初始化启动失败或中断在进入 XCTest 前也恢复，后续准备失败不能遮蔽', async t => {
  const root = temporary(t)
  const add = async (name, result, files = []) => {
    await new Promise(resolve => setTimeout(resolve, 5))
    const run = path.join(root, 'run-' + name)
    fs.mkdirSync(run)
    for (const file of files) fs.writeFileSync(path.join(run, file), '')
    if (result) fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(result))
  }
  await add('LaunchFailed', { status: 'failed', failure: { stage: 'initialize' } }, ['initialize-launch.log'])
  assert.equal(needsSimulatorRecovery(root), true)
  for (const stage of ['build', 'install']) {
    await add(stage, { status: 'failed', failure: { stage } })
    assert.equal(needsSimulatorRecovery(root), true, '保留启动故障的恢复需求')
  }
  await add('Passed', { status: 'passed' }, ['test.log'])
  assert.equal(needsSimulatorRecovery(root), false)
  await add('Interrupted', undefined, ['initialize-launch.log'])
  assert.equal(needsSimulatorRecovery(root), true, '启动尚无最终回执不能当作未进入原生运行')
  await add('PassedAgain', { status: 'passed' }, ['test.log'])
  await add('UiLaunchFailed', { status: 'failed', failure: { stage: 'initialize' } }, ['fixture.log', 'ui-launch.log'])
  assert.equal(needsSimulatorRecovery(root), true, '夹具后的 UI 预启动失败同样需要恢复')
})
test('未启动原生 App 的准备故障和已进入夹具的拒绝不新增设备恢复需求', async t => {
  for (const [name, stage, files] of [
    ['BeforeLaunch', 'initialize', []],
    ['Build', 'build', ['initialize-launch.log']],
    ['Fixture', 'initialize', ['initialize-launch.log', 'fixture.log']]
  ]) {
    const root = temporary(t)
    const run = path.join(root, 'run-' + name)
    fs.mkdirSync(run)
    for (const file of files) fs.writeFileSync(path.join(run, file), '')
    fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify({ status: 'failed', failure: { stage } }))
    assert.equal(needsSimulatorRecovery(root), false, name)
  }
})
test('单用例/场景选择只带显式必要前置，拒绝任意过滤器与中断半流程', () => {
  assert.deepEqual(
    selection('--case', 'NativeTests/NativeSqliteTests/testRejectUnownedTestContexts', []).cases,
    ['NativeTests/NativeSqliteTests/testRejectUnownedTestContexts']
  )
  assert.equal(selection('--scenario', 'template-tie', ['template-tie']).scenario, 'template-tie')
  for (const [scene, start, end] of [
    ['paging-merge', 'test11', 'test12'],
    ['paging-disable', 'test13', 'test14'],
    ['merge-relaunch', 'test09', 'test10']
  ]) {
    const result = selection('--scenario', scene, [])
    const business = result.cases.filter((name) => !name.endsWith('test00DebugKeyboardReady'))
    assert.equal(business.length, 2)
    assert.equal(result.cases.length, scene === 'merge-relaunch' ? 2 : 3)
    assert.ok(business[0].split('/').at(-1).startsWith(start))
    assert.ok(business[1].split('/').at(-1).startsWith(end))
    assert.deepEqual(selection('--case', result.cases.at(-1), []), result)
  }
  for (const value of [
    'NativeTests',
    'NativeTests/NativeSqliteTests/testPrepareProcessInterruption',
    'Other/NativeSqliteTests/testOfflineDictionaryPages',
    'DictionaryUITests/DictionaryTouchTests/test99',
    '../App'
  ]) {
    assert.throws(() => selection('--case', value, []))
  }
  for (const method of [
    'test01CreateProduct',
    'test02RenameProduct',
    'test03CreateCategory',
    'test04CreateUnit',
    'test05CreateFunding'
  ]) {
    assert.deepEqual(selection('--case', 'DictionaryUITests/DictionaryTouchTests/' + method, []).cases, [
      'DictionaryUITests/DictionaryTouchTests/test00DebugKeyboardReady',
      'DictionaryUITests/DictionaryTouchTests/' + method
    ])
  }
  assert.deepEqual(
    selection('--scenario', 'merge-cycle', []).cases.map((id) => id.split('/').at(-1)),
    ['test08MergeCancel', 'test09MergeConfirm', 'test10RelaunchedMergeCandidates']
  )
  assert.deepEqual(selection('--scenario', 'entry-cycle', []).cases, [
    'DictionaryUITests/DictionaryTouchTests/test00DebugKeyboardReady',
    'DictionaryUITests/DictionaryTouchTests/test15ExpensePrepareSave',
    'DictionaryUITests/DictionaryTouchTests/test15ExpenseRestart',
    'DictionaryUITests/DictionaryTouchTests/test15ExpenseWriteReopen',
    'DictionaryUITests/DictionaryTouchTests/test16IncomeAConfigure',
    'DictionaryUITests/DictionaryTouchTests/test16IncomeBSaveContinue',
    'DictionaryUITests/DictionaryTouchTests/test16IncomeCFocusHandoff',
    'DictionaryUITests/DictionaryTouchTests/test16IncomeContinueEdit'
  ])
  const entry = selection('--scenario', 'entry-cycle', [])
  const reopen = selection('--case', 'DictionaryUITests/DictionaryTouchTests/test15ExpenseWriteReopen', [])
  assert.deepEqual(reopen.cases, entry.cases.slice(0,4), '公开回读入口保留保存与重启前置')
  assert.deepEqual([...entry.cases].sort(),entry.cases,'顺序与 XCTest 方法排序一致')
  assert.deepEqual(selection('--case','DictionaryUITests/DictionaryTouchTests/test16IncomeContinueEdit',[]).cases, [entry.cases[0], ...entry.cases.slice(4)])
  for(const method of ['test15ExpensePrepareSave','test15ExpenseRestart','test16IncomeAConfigure','test16IncomeBSaveContinue','test16IncomeCFocusHandoff']) {
    assert.throws(()=>selection('--case','DictionaryUITests/DictionaryTouchTests/'+method,[]),'中间步骤不能绕过完整依赖单独运行')
    const full=fs.readFileSync(new URL('../../scripts/lib/ios-app-full.sh', import.meta.url),'utf8')
    assert.ok(full.includes('-skip-testing:DictionaryUITests/DictionaryTouchTests/'+method),'字典组不能误执行记账前置')
    assert.ok(full.includes('-only-testing:DictionaryUITests/DictionaryTouchTests/'+method),'完整记账组保留同一前置')
  }
  assert.equal(selection('--scenario', 'entry-cycle', []).fixture, 'entry-cycle')
  const keyboard = selection('--scenario', keyboardReadyScenario, [])
  assert.deepEqual(keyboard, {
    scheme: 'DictionaryTouch', configuration: 'Release', fixture: '0',
    cases: ['DictionaryUITests/DictionaryTouchTests/test00DebugKeyboardReady']
  }, '前置调试复用只读字典夹具与回读，不连带记账或业务用例')
  assert.throws(() => selection('--case', keyboard.cases[0], []), '私有前置不能变成任意单用例过滤器')
  assert.throws(() => selection('--scenario', 'unknown', []))
})
test('会话拒绝越界路径、符号链接、篡改清单、宽权限及已关闭设备', (t) => {
  const root = temporary(t)
  const directory = fs.mkdtempSync(path.join(root, 'ios-debug-'))
  const file = path.join(directory, 'test-context.json')
  const runId = randomUUID()
  const context = {
    schema: 1,
    kind: 'ios-debug',
    state: 'open',
    runId,
    simulatorId: randomUUID(),
    appId: APP_ID,
    name: `我的账单调试-${runId}`
  }
  const write = (c) => fs.writeFileSync(file, JSON.stringify(c), { mode: 0o600 })
  write(context)
  assert.equal(readSession(root, directory).context.simulatorId, context.simulatorId)
  const link = path.join(root, 'ios-debug-link')
  fs.symlinkSync(directory, link)
  assert.throws(() => readSession(root, link))
  assert.throws(() => readSession(root, root))
  for (const changed of [
    { state: 'closed' },
    { appId: 'other.app' },
    { simulatorId: 'physical' },
    { kind: 'native-full' }
  ]) {
    write({ ...context, ...changed })
    assert.throws(() => readSession(root, directory))
  }
  write({ ...context, state: 'closed' })
  assert.equal(readSession(root, directory, true).context.state, 'closed')
  write(context)
  fs.chmodSync(file, 0o644)
  assert.throws(() => readSession(root, directory))
  fs.chmodSync(file, 0o600)
  fs.writeFileSync(file, ' '.repeat(4097))
  assert.throws(() => readSession(root, directory))
  fs.writeFileSync(file, '{}')
  assert.throws(() => readSession(root, directory))
})
test('运行和关闭前核对 runtime、型号、名称、UUID 和可用状态，不接管用户设备', () => {
  const context = { simulatorId: randomUUID(), name: '本轮设备' }
  const device = {
    udid: context.simulatorId,
    name: context.name,
    isAvailable: true,
    deviceTypeIdentifier: DEVICE_TYPE
  }
  const inventory = (d) => ({ devices: { [RUNTIME]: [d] } })
  assert.equal(assertDevice(context, inventory(device)), device)
  for (const changed of [
    { udid: randomUUID() },
    { name: '用户原有手机' },
    { isAvailable: false },
    { deviceTypeIdentifier: 'other' }
  ]) {
    assert.throws(() => assertDevice(context, inventory({ ...device, ...changed })))
  }
  assert.throws(() => assertDevice(context, { devices: { other: [device] } }))
})
test('缓存以内容而非时间判断；生产/探针/工程/锁定依赖/工具链变化失效，忽略生成物', (t) => {
  const root = temporary(t)
  const files = [
    'app/src/view.vue',
    'app/native-tests/probe.ts',
    'app/test-support/scenario.ts',
    'app/ios/App/project.pbxproj',
    'app/package.json',
    'app/package-lock.json',
    'app/capacitor.config.ts',
    'app/vite.config.ts',
    'app/vitest.config.ts',
    'app/tsconfig.json',
    'app/tsconfig.tools.json',
    'scripts/normalize-capacitor-spm.mjs'
  ]
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), 'original')
  }
  const first = sourceHash(root, 'toolchain-1')
  assert.equal(sourceHash(root, 'toolchain-1'), first)
  for (const file of files) {
    const target = path.join(root, file),
      stat = fs.statSync(target)
    fs.writeFileSync(target, 'modified')
    fs.utimesSync(target, stat.atime, stat.mtime)
    assert.notEqual(sourceHash(root, 'toolchain-1'), first, file)
    fs.writeFileSync(target, 'original')
  }
  assert.notEqual(sourceHash(root, 'toolchain-2'), first)
  fs.mkdirSync(path.join(root, 'app/ios/App/App/public'), { recursive: true })
  fs.writeFileSync(path.join(root, 'app/ios/App/App/public/index.html'), 'generated')
  assert.equal(sourceHash(root, 'toolchain-1'), first)
  const products = fs.mkdtempSync(path.join(root, 'products-'))
  fs.writeFileSync(path.join(products, 'App'), 'binary')
  const built = hashPaths(products, ['.'])
  fs.writeFileSync(path.join(products, 'App'), 'tampered')
  assert.notEqual(hashPaths(products, ['.']), built)
})
function touchFixture(root) {
  const device = randomUUID()
  const container = path.join(
    root,
    'CoreSimulator/Devices',
    device,
    'data/Containers/Data/Application',
    randomUUID()
  )
  const directory = path.join(container, 'Library/OfflineLedger')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'ledgerSQLite.db')
  const database = new DatabaseSync(file)
  try {
    for (const name of ['0001_initial.sql', '0002_dictionary_governance.sql', '0003_ledger_writes.sql', '0004_snapshot_search.sql', '0005_personal_state.sql', '0006_adjustment_lifecycle.sql', '0007_ledger_query.sql', '0008_report_dimensions.sql']) {
      database.exec(
        fs.readFileSync(new URL('../../app/src/data/migrations/' + name, import.meta.url), 'utf8')
      )
    }
    for (let i = 0; i < 8; i++) {
      database
        .prepare(
          "INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,'INCOME_CATEGORY',?,?,'ACTIVE')"
        )
        .run(`61000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, i === 0 ? '工资' : '收入' + i, i === 0 ? '工资' : '收入' + i)
    }
  } finally {
    database.close()
  }
  const receipt = path.join(container, 'fixture.json')
  // 在测试进程边界冻结 Python 时钟；不为正式夹具增加可绕过日期的运行参数。
  const execute = (mode, clock, environment = {}) =>
    spawnSync('python3', clock ? ['-c', `
import datetime, runpy, sys
clock = sys.argv.pop(1)
class FrozenDateTime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls.fromisoformat(clock).astimezone(tz)
datetime.datetime = FrozenDateTime
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
`, clock, 'scripts/fixtures/dictionary-touch.py', mode, container, device, receipt]
      : ['scripts/fixtures/dictionary-touch.py', mode, container, device, receipt], {
      encoding: 'utf8', env: { ...process.env, ...environment }
    })
  return { file, receipt, execute }
}

test('iOS 交互三例及组合使用显式夹具，单例不串入其他触摸或原生专项', () => {
  const names=['test51IosKeyboardNavigation','test52IosCandidatesAndDate','test53IosLandscapeCandidates']
  for(const [index,name] of names.entries()) {
    const target='DictionaryUITests/DictionaryTouchTests/'+name
    const selected=selection('--case',target,[])
    assert.deepEqual(selected,{scheme:'DictionaryTouch',configuration:'Release',fixture:'interaction-'+(61+index),cases:[target]})
  }
  assert.equal(selection('--scenario','ios-interaction',[]).fixture,'interaction-61,62,63')
  assert.equal(selection('--scenario','ios-candidates',[]).fixture,'interaction-62,63')
  assert.equal(selection('--scenario','query-input',[]).fixture,'query-34,35')
})

/** 仅检查夹具协议，模拟的落盘结果不作为三例真实 XCUITest 通过。 */
function interactionFixture(t) {
  const f=touchFixture(temporary(t)), db=new DatabaseSync(f.file)
  db.exec("INSERT INTO ledger_meta VALUES(1,8,'interaction-dataset',1,1,'2026-11-27','2026-11-27')")
  db.prepare("UPDATE dictionary_item SET name='其他收入',normalized_name='其他收入' WHERE id=?")
    .run('61000000-0000-0000-0000-000000000008')
  t.after(()=>db.close())
  const outcome=cases=>{
    if(cases.includes(61))db.prepare('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)')
      .run('interaction-dataset','EXPENSE',JSON.stringify({unitPrice:'12.3456'}),'now','now')
    if(cases.includes(62)||cases.includes(63))db.prepare('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)')
      .run('interaction-dataset','INCOME',JSON.stringify({incomeCategoryId:'61000000-0000-0000-0000-00000000000'+(cases.includes(63)?1:8)}),'now','now')
    db.prepare("UPDATE preference SET value=? WHERE key='recentEntryType'")
      .run(JSON.stringify(cases.includes(63)?'INCOME':'EXPENSE'))
    if(cases.includes(62)||cases.includes(63))db.prepare("INSERT OR REPLACE INTO preference VALUES('updatedAt',?)")
      .run(JSON.stringify(new Date().toISOString()))
  }
  return {...f,db,outcome}
}

test('iOS 交互只读夹具：三单例/两组合先捕获后回读，不预写草稿或覆盖既有回执', t => {
  for(const cases of [[61],[62],[63],[62,63],[61,62,63]]) {
    const f=interactionFixture(t),fixture=cases.join(','),before=fs.readFileSync(f.file)
    const prepared=f.execute('debug-interaction-'+fixture)
    assert.equal(prepared.status,0,prepared.stderr)
    assert.match(prepared.stdout,new RegExp('IOS_INTERACTION_FIXTURE_PREPARED cases='+fixture))
    assert.deepEqual(fs.readFileSync(f.file),before,'准备不预写待验结果')
    const receipt=fs.readFileSync(f.receipt)
    assert.notEqual(f.execute('debug-check-interaction-'+fixture).status,0,'未执行交互不能通过')
    assert.notEqual(f.execute('debug-interaction-'+fixture).status,0,'拒绝覆盖回执')
    assert.deepEqual(fs.readFileSync(f.receipt),receipt)
    f.outcome(cases)
    const after=fs.readFileSync(f.file),checked=f.execute('debug-check-interaction-'+fixture)
    assert.equal(checked.status,0,checked.stderr)
    assert.equal(checked.stdout.trim(),'IOS_INTERACTION_SQLITE_VERIFIED cases='+fixture)
    assert.deepEqual(fs.readFileSync(f.receipt),receipt)
    assert.deepEqual(fs.readFileSync(f.file),after,'回读不修改数据')
  }
})

test('iOS 搜索触摸等待完整键盘并处理首次引导，不作废其他用例',()=>{
  const swift=fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift',import.meta.url),'utf8')
  const body=swift.slice(swift.indexOf('func test51IosKeyboardNavigation()'),swift.indexOf('func test52IosCandidatesAndDate()'))
  assert.match(body,/search.tap\(\)[\s\S]*waitForExistence\(timeout: 3\)[\s\S]*completeKeyboardIntroductionIfPresent\(\)[\s\S]*XCTAssertGreaterThan\(app.keyboards.firstMatch.keys.count, 0\)[\s\S]*search.typeText\("中文输入"\)[\s\S]*expectValue\(search,"中文输入"\)/)
  assert.match(body,/if orientation == \.portrait \{\s*completeKeyboardIntroductionIfPresent\(\)[\s\S]*dismissSearchKeyboard\(\)[\s\S]*search.tap\(\)[\s\S]*waitForExistence\(timeout: 3\)/)
  assert.match(body,/if orientation == \.landscapeLeft \{ expectValue\(search,"中文输入"\) \}[\s\S]*if orientation == \.portrait \{\s*search.typeText\("中文输入"\)[\s\S]*else \{[\s\S]*search.typeText\(String\(repeating: XCUIKeyboardKey.delete.rawValue,count:4\)\)/)
  assert.match(body,/dismissSearchKeyboard\(\)[\s\S]*expectValue\(search,"中文输入"\)[\s\S]*guard let value = search.value as\? String else \{ return false \}[\s\S]*value.isEmpty \|\| value == search.placeholderValue[\s\S]*XCTWaiter.wait\(for:\[empty\],timeout:3\)/)
  assert.equal(body.match(/search.typeText\("中文输入"\)/g).length,1)
  assert.match(body,/search.exists \|\| search.waitForExistence\(timeout: 3\)/)
  assert.match(body,/app.keyboards.firstMatch.exists \|\| app.keyboards.firstMatch.waitForExistence\(timeout: 3\)/)
  assert.match(body,/let price = app.textFields.matching\(NSPredicate\(format:"identifier == %@ OR label == %@","expense-unit-price","单价"\)\).firstMatch/)
  assert.equal(body.match(/expectValue\(price,"12.3456"\)/g).length,2,'横屏保留值和每个方向导航返回后的精确回读都保留')
  assert.doesNotMatch(body,/expectValue\(entryField\("expense-unit-price"/)
  assert.match(body,/search.coordinate\(withNormalizedOffset:CGVector\(dx:0.99,dy:0.5\)\).tap\(\)\s*search.typeText\(String\(repeating: XCUIKeyboardKey.delete.rawValue,count:4\)\)/)
  const previous=swift.replace(body,'func test51IosKeyboardNavigation() { }\n\n    ')
  for(const name of uiCases.filter(name=>name!=='test51IosKeyboardNavigation'))
    assert.equal(swiftCaseInput(swift,name),swiftCaseInput(previous,name),name)
  assert.notEqual(swiftCaseInput(swift,'test51IosKeyboardNavigation'),swiftCaseInput(previous,'test51IosKeyboardNavigation'))
})

test('iOS 横屏候选完整组合保留键盘前置、边界及精确回读',()=>{
  const swift=fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift',import.meta.url),'utf8')
  const start=swift.indexOf('func test53IosLandscapeCandidates()'),end=swift.indexOf('\n    private func ',start)
  assert.ok(start>=0 && end>start)
  const body=swift.slice(start,end)
  assert.deepEqual(selection('--scenario','ios-interaction',[]).cases.map(id=>id.split('/').at(-1)),
    ['test51IosKeyboardNavigation','test52IosCandidatesAndDate','test53IosLandscapeCandidates'])
  assert.match(body,/choice.frame.midY > top && choice.frame.midY < bottom/)
  assert.match(body,/XCTAssertTrue\(choice.isHittable,app.debugDescription\)[\s\S]*choice.tap\(\)[\s\S]*dismissSearchKeyboard\(\)[\s\S]*expectValue\(input,"工资"\)/)
  assert.match(body,/XCTAssertTrue\(save.exists && save.isHittable\)/)
})

test('iOS 交互偏好元数据只允许本轮真实保存时间，缺失/非法/跨轮及无关改写仍拒绝',t=>{
  for(const mutation of ['valid','missing','malformed','old','future','unrelated','no-save']) {
    const f=interactionFixture(t),cases=mutation==='no-save'?[61]:[62,63],scene=cases.join(',')
    assert.equal(f.execute('debug-interaction-'+scene).status,0)
    f.outcome(cases)
    const reference=JSON.parse(fs.readFileSync(f.receipt))
    if(mutation==='missing')f.db.exec("DELETE FROM preference WHERE key='updatedAt'")
    if(['malformed','old','future','no-save'].includes(mutation))f.db.prepare("INSERT OR REPLACE INTO preference VALUES('updatedAt',?)")
      .run(JSON.stringify(mutation==='malformed'?'not-a-time':new Date(mutation==='old'?reference.capturedAt-1000:Date.now()+86400000).toISOString()))
    if(mutation==='unrelated')f.db.exec("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
    const before=fs.readFileSync(f.file),receipt=fs.readFileSync(f.receipt),result=f.execute('debug-check-interaction-'+scene)
    assert.equal(result.status===0,mutation==='valid',mutation+': '+result.stderr)
    assert.deepEqual(fs.readFileSync(f.file),before,'回读不能修正原数据')
    assert.deepEqual(fs.readFileSync(f.receipt),receipt,'回读不能补写捕获回执')
  }
})

test('iOS 交互回读拒绝错场景/数据集/草稿值、字典/业务/偏好改写及损坏回执，拒绝时无副作用',t=>{
  for(const mutation of ['case','dataset','draftDataset','value','dictionary','business','preference','truncated','symlink']) {
    const f=interactionFixture(t)
    assert.equal(f.execute('debug-interaction-61').status,0)
    f.outcome([61])
    if(mutation==='case') {const r=JSON.parse(fs.readFileSync(f.receipt));r.cases=[62];fs.writeFileSync(f.receipt,JSON.stringify(r))}
    if(mutation==='dataset')f.db.exec("UPDATE ledger_meta SET dataset_id='other'")
    if(mutation==='draftDataset')f.db.exec("UPDATE ledger_draft SET dataset_id='other'")
    if(mutation==='value')f.db.exec(`UPDATE ledger_draft SET data_json='{"unitPrice":"12.3457"}'`)
    if(mutation==='dictionary')f.db.exec("UPDATE dictionary_item SET name='改名',normalized_name='改名' WHERE name='工资'")
    if(mutation==='business')f.db.exec("INSERT INTO idempotency_result VALUES('unexpected','operation','digest','{}','now')")
    if(mutation==='preference')f.db.exec("INSERT INTO preference VALUES('unexpected','true')")
    if(mutation==='truncated')fs.writeFileSync(f.receipt,'{"schema":')
    if(mutation==='symlink'){fs.renameSync(f.receipt,f.receipt+'.source');fs.symlinkSync(f.receipt+'.source',f.receipt)}
    const before=fs.readFileSync(f.file),receipt=fs.readFileSync(f.receipt)
    const result=f.execute('debug-check-interaction-61')
    assert.notEqual(result.status,0,mutation)
    assert.doesNotMatch(result.stdout,/IOS_INTERACTION_SQLITE_VERIFIED/,mutation)
    assert.deepEqual(fs.readFileSync(f.file),before,mutation)
    assert.deepEqual(fs.readFileSync(f.receipt),receipt,mutation)
  }
})

test('iOS 交互夹具拒绝跨安装回执、重复/乱序/未知场景和残留草稿，不清理原数据',t=>{
  const a=interactionFixture(t),b=interactionFixture(t)
  assert.equal(a.execute('debug-interaction-61').status,0)
  fs.copyFileSync(a.receipt,b.receipt)
  b.outcome([61])
  assert.notEqual(b.execute('debug-check-interaction-61').status,0,'数据集相同也不能跨安装')
  for(const invalid of ['61,61','63,62','64']) {
    const f=interactionFixture(t),before=fs.readFileSync(f.file)
    assert.notEqual(f.execute('debug-interaction-'+invalid).status,0,invalid)
    assert.deepEqual(fs.readFileSync(f.file),before)
    assert.equal(fs.existsSync(f.receipt),false)
  }
  const f=interactionFixture(t);f.outcome([61]);const before=fs.readFileSync(f.file)
  assert.notEqual(f.execute('debug-interaction-61').status,0,'残留草稿不得被当作新夹具')
  assert.deepEqual(fs.readFileSync(f.file),before)
  assert.equal(fs.existsSync(f.receipt),false)
})

test('iOS 交互优化模式拒绝执行，不能删除归属与数据保护断言',t=>{
  const f=interactionFixture(t),before=fs.readFileSync(f.file)
  const result=f.execute('debug-interaction-61',undefined,{PYTHONOPTIMIZE:'1'})
  assert.notEqual(result.status,0)
  assert.match(result.stderr,/安全校验不允许 Python 优化模式/)
  assert.deepEqual(fs.readFileSync(f.file),before)
  assert.equal(fs.existsSync(f.receipt),false)
})

/** 仅供夹具检查器正反例，不作为 App 业务写入/页面验收。 */
function writeEntryOutcome(database, selected) {
  if (selected === 15) {
    database.prepare(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
      product_id,product_name_snapshot,unit_id,unit_name_snapshot,unit_price_scaled,quantity_scaled,calculated_amount_cents)
      VALUES('t6-saved-expense','EXPENSE',1500,'t6-funding','测试现金','2026-11-17T01:00:00.000Z','2026-11-17','t6-product','测试苹果','t6-unit','斤',123456,1250,1543)`).run()
    return 't6-saved-expense'
  }
  database.prepare(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
    income_name,payer_id,payer_name_snapshot,note,row_version) VALUES('t6-saved-income','INCOME',100000,'t6-funding','测试现金',
    '2026-11-17T01:00:00.000Z','2026-11-17','测试工资','t6-payer','合成公司','T6 edited',2)`).run()
  return 't6-saved-income'
}

test('UI 局部夹具拒绝已有数据；准备改名/恢复/末页前置，回读拒绝未执行或历史被改写', (t) => {
  const root = temporary(t)
  for (const selected of [2, 7, 12, 14, 15, 16]) {
    const { file, receipt, execute } = touchFixture(root)
    assert.equal(execute('debug-' + selected).status, 0)
    const ids = JSON.parse(fs.readFileSync(receipt, 'utf8'))
    const check = new DatabaseSync(file)
    try {
      if (selected === 2)
        assert.equal(
          check.prepare("SELECT count(*) AS n FROM dictionary_item WHERE name='Touch Created'").get().n,
          1
        )
      if (selected === 7)
        assert.equal(
          check.prepare('SELECT status FROM dictionary_item WHERE id=?').get(ids.maintenance).status,
          'INACTIVE'
        )
      if (selected === 12 || selected === 14)
        for (const prefix of ['PageProduct%', 'PageUnit%'])
          assert.equal(
            check.prepare('SELECT count(*) AS n FROM dictionary_item WHERE name LIKE ?').get(prefix).n,
            21
          )
      assert.notEqual(execute('debug-check-' + selected).status, 0, '未执行目标操作不能判通过')
      if (selected >= 15) {
        assert.equal(check.prepare("SELECT CAST(last_unit_price_scaled AS TEXT) AS price FROM product_details WHERE product_id='t6-product'").get().price, '123456')
        assert.equal(check.prepare("SELECT count(*) AS n FROM ledger_entry WHERE id<>'t6-name-history' AND payer_id='t6-payer'").get().n, 0)
        const savedId = writeEntryOutcome(check, selected)
        assert.equal(execute('debug-check-' + selected).status, 0, '必须回读真实金额/名称/版本/类型字段')
        check.prepare("UPDATE ledger_entry SET amount_cents=1 WHERE id=?").run(savedId)
        assert.notEqual(execute('debug-check-' + selected).status, 0, '错误金额不能通过回读')
      }
      const count = check.prepare('SELECT count(*) AS n FROM dictionary_item').get().n
      assert.notEqual(execute('debug-' + selected).status, 0, '拒绝重铺已有测试数据')
      assert.equal(check.prepare('SELECT count(*) AS n FROM dictionary_item').get().n, count)
      if (selected === 7) {
        check.prepare("UPDATE dictionary_item SET status='ACTIVE' WHERE id=?").run(ids.maintenance)
        assert.equal(execute('debug-check-7').status, 0)
        check.prepare('UPDATE ledger_entry SET amount_cents=17 WHERE id=?').run(ids.entry)
        assert.notEqual(execute('debug-check-7').status, 0, '历史金额改变必须失败')
      }
    } finally {
      check.close()
    }
  }
})
test('收支组合夹具必须同时保留两笔结果，单场景拒绝误提交另一类型草稿', (t) => {
  const root = temporary(t)
  const { file, execute } = touchFixture(root)
  assert.equal(execute('debug-entry-cycle').status, 0)
  const database = new DatabaseSync(file)
  try {
    assert.notEqual(execute('debug-check-entry-cycle').status, 0)
    const expense = writeEntryOutcome(database, 15)
    assert.notEqual(execute('debug-check-entry-cycle').status, 0, '只有支出不能代表组合通过')
    writeEntryOutcome(database, 16)
    assert.equal(execute('debug-check-entry-cycle').status, 0)
    assert.notEqual(execute('debug-check-16').status, 0, '单收入场景不能额外提交支出草稿')
    database.prepare('UPDATE ledger_entry SET amount_cents=1 WHERE id=?').run(expense)
    assert.notEqual(execute('debug-check-entry-cycle').status, 0, '后续场景不能破坏前一笔支出')
  } finally {
    database.close()
  }
})
test('收入备注局部只选输入窗口交接与编辑，预置来源不能冒充保存或组合验收', t => {
  const chosen = selection('--scenario', incomeNoteScenario, [])
  assert.deepEqual(chosen, { scheme: 'DictionaryTouch', configuration: 'Release', fixture: 'income-note',
    cases: ['test16IncomeCFocusHandoff','test16IncomeContinueEdit'].map(name => 'DictionaryUITests/DictionaryTouchTests/' + name) })
  assert.throws(() => selection('--case', chosen.cases[0], []))
  const { file, receipt, execute } = touchFixture(temporary(t))
  const database = new DatabaseSync(file)
  try {
    database.prepare("INSERT INTO ledger_meta VALUES(1,8,'note-dataset',1,1,'2026-11-26','2026-11-26')").run()
    const prepared = execute('debug-income-note')
    assert.equal(prepared.status, 0, prepared.stderr)
    const ids = JSON.parse(fs.readFileSync(receipt, 'utf8')), target = ids.incomeNoteTarget
    assert.match(ids.incomeNoteOriginal.business_time, /:00\.000Z$/, '与原页面分钟精度一致，编辑仍须保护原业务时间')
    assert.deepEqual({ ...database.prepare('SELECT note,row_version FROM ledger_entry WHERE id=?').get(target) }, { note: null, row_version: 1 })
    assert.notEqual(execute('debug-check-income-note').status, 0, '预置空备注不能通过')
    assert.notEqual(execute('debug-check-entry-cycle').status, 0, '预置来源不能冒充真实收支保存')
    database.prepare("UPDATE ledger_entry SET note='T6 edited',row_version=2,search_text='测试工资 合成公司 工资 测试现金 t6 edited',adjustment_source_search_text='测试现金' WHERE id=?").run(target)
    assert.equal(execute('debug-check-income-note').status, 0)
    for (const column of ['search_text','adjustment_source_search_text']) {
      const original = database.prepare(`SELECT ${column} AS value FROM ledger_entry WHERE id=?`).get(target).value
      database.prepare(`UPDATE ledger_entry SET ${column}='wrong' WHERE id=?`).run(target)
      assert.notEqual(execute('debug-check-income-note').status, 0, '派生索引也必须正确：' + column)
      database.prepare(`UPDATE ledger_entry SET ${column}=? WHERE id=?`).run(original,target)
    }
    database.prepare('UPDATE ledger_entry SET amount_cents=1 WHERE id=?').run(target)
    assert.notEqual(execute('debug-check-income-note').status, 0, '目标其他字段改变必须拒绝')
    database.prepare('UPDATE ledger_entry SET amount_cents=100000 WHERE id=?').run(target)
    database.prepare("UPDATE ledger_meta SET dataset_id='other-dataset'").run()
    assert.notEqual(execute('debug-check-income-note').status, 0, '数据集改变必须拒绝')
    database.prepare("UPDATE ledger_meta SET dataset_id='note-dataset'").run()
    database.prepare("UPDATE ledger_entry SET note='unexpected' WHERE id='t6-name-history'").run()
    assert.notEqual(execute('debug-check-income-note').status, 0, '其他历史账目改变必须拒绝')
  } finally { database.close() }
})
test('连续保存后备注局部只重放已授权的一项前置，夹具不预写正式收入', t => {
  assert.deepEqual(selection('--scenario', incomeNoteAfterSaveScenario, []), {
    scheme: 'DictionaryTouch', configuration: 'Release', fixture: 'income-note-after-save',
    cases: ['test16IncomeBSaveContinue','test16IncomeContinueEdit'].map(name => 'DictionaryUITests/DictionaryTouchTests/' + name),
  })
  const { file, receipt, execute } = touchFixture(temporary(t)), db = new DatabaseSync(file)
  try {
    db.prepare("INSERT INTO ledger_meta VALUES(1,9,'save-note-dataset',1,1,'2026-11-26','2026-11-26')").run()
    const prepared = execute('debug-income-note-after-save')
    assert.equal(prepared.status, 0, prepared.stderr)
    const ids = JSON.parse(fs.readFileSync(receipt,'utf8'))
    assert.equal(db.prepare("SELECT count(*) AS n FROM ledger_entry WHERE payer_id='t6-payer' AND id<>'t6-name-history'").get().n, 0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM ledger_draft').get().n, 2)
    assert.notEqual(execute('debug-check-income-note-after-save').status, 0, '未保存不能通过')
    const target = writeEntryOutcome(db,16)
    db.prepare("UPDATE ledger_entry SET business_time=?,business_date=?,income_category_id='61000000-0000-0000-0000-000000000001',search_text='测试工资 合成公司 工资 测试现金 t6 edited',adjustment_source_search_text='测试现金' WHERE id=?").run(ids.incomeSaveBusinessTime,ids.incomeSaveBusinessDate,target)
    assert.equal(execute('debug-check-income-note-after-save').status, 0)
    db.prepare("UPDATE ledger_entry SET note='T' WHERE id=?").run(target)
    assert.notEqual(execute('debug-check-income-note-after-save').status, 0, '截断输入不能通过')
    db.prepare("UPDATE ledger_entry SET note='T6 edited' WHERE id=?").run(target)
    db.prepare("UPDATE ledger_meta SET dataset_id='other-dataset'").run()
    assert.notEqual(execute('debug-check-income-note-after-save').status, 0, '跨数据集不能通过')
    db.prepare("UPDATE ledger_meta SET dataset_id='save-note-dataset'").run()
    db.prepare("UPDATE ledger_draft SET data_json='{}' WHERE entry_type='EXPENSE'").run()
    assert.notEqual(execute('debug-check-income-note-after-save').status, 0, '原支出草稿不能丢失')
  } finally { db.close() }
})
test('原生收键盘有终态且重复调用无操作，输入窗口交接不重放保存或更改金额', () => {
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const verify = source => {
    const native = source.slice(source.indexOf('private func dismissNativeKeyboard()'), source.indexOf('private func searchAndGoToLastPage('))
    assert.match(native, /if app.keyboards.firstMatch.exists \{[\s\S]*done\?\.tap\(\)[\s\S]*disappears\(app.keyboards.firstMatch\)/)
    assert.doesNotMatch(native, /swipe|typeText|else \{/)
    for (const name of ['dismissSearchKeyboard','dismissEntryKeyboard'])
      assert.match(source, new RegExp('private func '+name+'\\(\\) \\{\\s*dismissNativeKeyboard\\(\\)\\s*\\}'))
    const handoff = source.slice(source.indexOf('func test16IncomeCFocusHandoff()'), source.indexOf('func test16IncomeContinueEdit()'))
    assert.match(handoff, /let original = try XCTUnwrap\(amount.value as\? String\)[\s\S]*amount.tap\(\)[\s\S]*waitForExistence\(timeout: 3\)[\s\S]*dismissEntryKeyboard\(\)[\s\S]*dismissEntryKeyboard\(\)[\s\S]*XCTAssertFalse\(app.keyboards.firstMatch.exists\)[\s\S]*expectValue\(amount, original\)/)
    assert.doesNotMatch(handoff, /typeText|tap\("保存|terminate\(|launch\(|sleep\(/)
    const edit = source.slice(source.indexOf('func test16IncomeContinueEdit()'), source.indexOf('func test17ExpenseTemplateUpsert()'))
    assert.match(edit, /note.coordinate\(withNormalizedOffset: CGVector\(dx: 0.1, dy: 0.1\)\).tap\(\)[\s\S]*keyboards.firstMatch.waitForExistence\(timeout: 3\)[\s\S]*keyboards.firstMatch.keys.count, 0\)[\s\S]*note.typeText/)
    assert.match(edit, /note.typeText\("T6 edited"\)[\s\S]*expectValue\(note, "T6 edited"\)[\s\S]*dismissEntryKeyboard\(\)[\s\S]*expectValue\(note, "T6 edited"\)[\s\S]*tap\("保存修改"\)/)
  }
  verify(swift)
  assert.throws(() => verify(swift.replace('if app.keyboards.firstMatch.exists {', 'if true {')))
  assert.throws(() => verify(swift.replace('disappears(app.keyboards.firstMatch)', 'app.webViews.firstMatch.swipeUp()')))
  assert.throws(() => verify(swift.replace('expectValue(amount, original)', 'expectValue(amount, "")')))
  const target = swift.indexOf('func test16IncomeContinueEdit()')
  assert.throws(() => verify(swift.slice(0,target) + swift.slice(target).replace('expectValue(note, "T6 edited")', '')))
})
test('T8 局部选择保留业务前置并隔离清理场景', () => {
  const selected = selection('--scenario', 'lifecycle-cycle', [])
  assert.equal(selected.fixture, 'lifecycle-26,27,28,29,30')
  assert.equal(selected.cases.length, 6)
  assert.equal(selection('--case', 'DictionaryUITests/DictionaryTouchTests/test29LinkedPurgeCancelConfirm', []).fixture, 'lifecycle-26,28,29')
  assert.equal(selection('--scenario', 'cleanup-relaunch', []).fixture, 'lifecycle-30')
  assert.equal(selection('--case', 'NativeTests/NativeSqliteTests/testOfflineAdjustmentLifecycle', []).cases.length, 1)
  assert.deepEqual(selection('--case', 'NativeTests/NativeSqliteTests/testOfflineCleanupFinalization', []).cases,
    ['NativeTests/NativeSqliteTests/testOfflineCleanupFinalization'])
  assert.deepEqual(selection('--case', 'NativeTests/NativeSqliteTests/testOfflineCleanupForegroundState', []).cases,
    ['NativeTests/NativeSqliteTests/testOfflineCleanupForegroundState'])
  assert.deepEqual(selection('--case', 'NativeTests/NativeSqliteTests/testNativeLifecycleDraftWindow', []).cases,
    ['NativeTests/NativeSqliteTests/testNativeLifecycleDraftWindow'])
})
test('金额空值断言拒绝不可读值，调整输入保持无关用例范围', () => {
  const swift=fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift',import.meta.url),'utf8')
  let old=swift
  for(const [name,next,value] of [['test26AdjustmentCreate','test27AdjustmentLimits','3'],['test27AdjustmentLimits','test28SourceTrashRestore','13']]) {
    const body=swift.slice(swift.indexOf('func '+name+'()'),swift.indexOf('func '+next+'()'))
    const check=source=>{
      assert.match(source,/guard let old = amount.value as\? String, old.isEmpty \|\| old == amount.placeholderValue else \{[\s\S]*XCTFail\([\s\S]*return/)
      assert.match(source,/waitForExistence\(timeout: 3\)[\s\S]*amount.typeText\("[0-9]+"\)[\s\S]*XCTAssertLessThan\(app.frame.width, app.frame.height\)[\s\S]*app.coordinate\(withNormalizedOffset: CGVector\(dx: 0.92, dy: 0.965\)\).tap\(\)[\s\S]*disappears\(app.keyboards.firstMatch\)[\s\S]*expectValue\(amount, "[0-9]+"\)/)
    }
    check(body)
    assert.throws(()=>check(body.replace('guard let old = amount.value as? String, old.isEmpty || old == amount.placeholderValue else {','if (amount.value as? String) != amount.placeholderValue {')))
    assert.throws(()=>check(body.replace('expectValue(amount, "'+value+'")','')))
    const start=old.indexOf('        // 本套固定 14 Pro Max 竖屏',old.indexOf('func '+name+'()'))
    const end=old.indexOf('        expectValue(amount, "'+value+'")',start)+('        expectValue(amount, "'+value+'")').length
    old=old.slice(0,start)+'        replaceEntryField("adjustment-amount", "调整金额", "'+value+'")\n        dismissEntryKeyboard()'+old.slice(end)
  }
  for(const name of ['test17ExpenseTemplateUpsert','test19DisableTemplateUnit','test21IncomeTemplateCycle',
    'test15ExpensePrepareSave','test16IncomeCFocusHandoff','test23SaveThemePreference','test37ReportTimeGrains'])
    assert.equal(swiftCaseInput(swift,name),swiftCaseInput(old,name),name)
  for(const name of ['test26AdjustmentCreate','test27AdjustmentLimits'])assert.notEqual(swiftCaseInput(swift,name),swiftCaseInput(old,name),name)
  const income=swift.slice(swift.indexOf('func test16IncomeBSaveContinue()'),swift.indexOf('func test16IncomeCFocusHandoff()'))
  const checkIncome=source=>assert.match(source,/guard let old = amount.value as\? String, old.isEmpty \|\| old == amount.placeholderValue else \{[\s\S]*XCTFail\([\s\S]*return/)
  checkIncome(income)
  assert.throws(()=>checkIncome(income.replace('guard let old = amount.value as? String','if let old = amount.placeholderValue')))

  const note=swift.slice(swift.indexOf('func test18ExpenseTemplateFill()'),swift.indexOf('func test19DisableTemplateUnit()'))
  assert.match(note,/guard let value = note.value as\? String else \{[\s\S]*XCTFail\([\s\S]*return[\s\S]*XCTAssertTrue\(value.isEmpty \|\| value == note.placeholderValue\)/)
  const rejectNullable=source=>assert.doesNotMatch(source,/\(\w+\.value as\? String\)\s*==\s*\w+\.placeholderValue/,'不能把 nil == nil 视为已验证空值')
  rejectNullable(swift)
  assert.throws(()=>rejectNullable(swift+'\nXCTAssertTrue((note.value as? String) == note.placeholderValue)'))

})

test('T7 局部选择保留必要前置，模板与重启场景不混入另一组', () => {
  const templates = selection('--scenario', 'template-cycle', [])
  assert.equal(templates.fixture, 'personal-17,18,19,20,21')
  assert.equal(templates.cases.length, 6)
  assert.ok(templates.cases.every(id => !id.includes('test22') && !id.includes('test24')))
  const drafts = selection('--scenario', 'draft-relaunch', [])
  assert.equal(drafts.fixture, 'personal-22,23,24,25')
  assert.equal(drafts.cases.length, 5)
  const fallback = selection('--case', 'DictionaryUITests/DictionaryTouchTests/test20TemplateFallbackRemove', [])
  assert.equal(fallback.fixture, 'personal-17,19,20')
  assert.equal(selection('--case', 'NativeTests/NativeSqliteTests/testOfflinePersonalState', []).cases.length, 1)
})
test('T7 夹具不替代被验收操作，回读拒绝未保存、串写和来源变动', (t) => {
  const { file, execute } = touchFixture(temporary(t))
  const prepared = execute('debug-personal-22,23,24')
  assert.equal(prepared.status, 0, prepared.stderr)
  assert.notEqual(execute('debug-check-personal-22,23,24').status, 0)
  const database = new DatabaseSync(file)
  try {
    // 仅验证检查器的正反例，不作为 App 业务或页面证明。
    database.prepare(`INSERT INTO ledger_meta VALUES(1,6,'fixture-dataset',1,1,'2026-11-17','2026-11-17')`).run()
    for (const [type, value] of [['EXPENSE', { paidAmount: '77' }], ['INCOME', { amount: '222' }]]) {
      database.prepare('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)').run('fixture-dataset', type, JSON.stringify(value), '2026-11-17', '2026-11-17')
    }
    database.prepare("UPDATE preference SET value='\"DARK\"' WHERE key='theme'").run()
    database.prepare("UPDATE preference SET value='\"THIS_WEEK\"' WHERE key='ledgerRange'").run()
    database.prepare("UPDATE preference SET value='\"INCOME\"' WHERE key='recentEntryType'").run()
    assert.equal(execute('debug-check-personal-22,23,24').status, 0)
    database.prepare("UPDATE ledger_draft SET data_json='{}' WHERE entry_type='INCOME'").run()
    assert.notEqual(execute('debug-check-personal-22,23,24').status, 0)
    database.prepare("UPDATE ledger_draft SET data_json=? WHERE entry_type='INCOME'").run(JSON.stringify({ amount: '222' }))
    database.prepare("UPDATE ledger_entry SET amount_cents=1 WHERE id='t7-expense'").run()
    assert.notEqual(execute('debug-check-personal-22,23,24').status, 0)
  } finally {
    database.close()
  }
})
test('T7 单位停用在长列表中先搜索，夹具保留首屏外目标且拒绝修改其他单位', t => {
  const selected = selection('--case', 'DictionaryUITests/DictionaryTouchTests/test19DisableTemplateUnit', [])
  assert.equal(selected.fixture, 'personal-19')
  assert.equal(selected.cases.length, 2, '仅目标和既有键盘前置')
  const { file, execute } = touchFixture(temporary(t))
  assert.equal(execute('debug-personal-19').status, 0)
  const db = new DatabaseSync(file)
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM dictionary_item WHERE kind='UNIT' AND name LIKE 'PageUnit%'").get().n, 21)
    assert.ok(db.prepare("SELECT count(*) AS n FROM dictionary_item WHERE kind='UNIT' AND sort_order < (SELECT sort_order FROM dictionary_item WHERE id='t7-unit')").get().n >= 10)
    assert.equal(db.prepare("SELECT status FROM dictionary_item WHERE id='t7-unit'").get().status, 'ACTIVE')
    assert.notEqual(execute('debug-check-personal-19').status, 0, '未执行页面停用不能通过')
    db.prepare("UPDATE dictionary_item SET status='INACTIVE' WHERE id='t7-unit'").run()
    assert.equal(execute('debug-check-personal-19').status, 0)
    db.prepare("UPDATE dictionary_item SET status='INACTIVE' WHERE name='PageUnit00'").run()
    assert.notEqual(execute('debug-check-personal-19').status, 0, '误停用背景单位必须拒绝')
  } finally { db.close() }
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const assertSearch = source => {
    const body = source.slice(source.indexOf('func test19DisableTemplateUnit()'), source.indexOf('func test20TemplateFallbackRemove()'))
    assert.match(body, /searchDictionary\(kind: "单位", text: "日常份"\)[\s\S]*tap\("管理日常份"\)/)
    assert.match(body, /appears\("停用日常份？"\)/)
    assert.match(body, /disappears\(matching\("停用日常份？"\)/)
  }
  assertSearch(swift)
  assert.throws(() => assertSearch(swift.replace('searchDictionary(kind: "单位", text: "日常份")', 'openKind("单位")')))
  const assertKeyboard = source => {
    const body = source.slice(source.indexOf('func test00DebugKeyboardReady()'), source.indexOf('func test51IosKeyboardNavigation()'))
    assert.match(body, /tap\("明细"\)[\s\S]*tapVisibleText\("搜索账目", containing: true\)[\s\S]*XCTAssertTrue\(keyboard.waitForExistence\(timeout: 3\)/)
    assert.match(body, /XCTAssertGreaterThan\(keyboard.keys.count, 0,[\s\S]*XCTWaiter.wait\(for: \[empty\][\s\S]*dismissSearchKeyboard\(\)[\s\S]*tapVisibleText\("记一笔"\)/)
    assert.match(body, /XCTAssertTrue\(field.waitForExistence\(timeout: 3\)/)
    assert.match(body, /keyboard.waitForExistence\(timeout: 3\)[\s\S]*completeKeyboardIntroductionIfPresent\(\)[\s\S]*XCTAssertGreaterThan\(keyboard.keys.count/)
    const introduction = source.slice(source.indexOf('private func completeKeyboardIntroductionIfPresent()'), source.indexOf('func test51IosKeyboardNavigation()'))
    assert.match(introduction, /if visualText\("Speed up your typing", containing: true\) != nil \{[\s\S]*tapVisibleText\("Continue"\)[\s\S]*self.visualText\("Speed up your typing", containing: true\) == nil[\s\S]*XCTWaiter.wait\(for: \[dismissed\], timeout: 3\)/)
    assert.match(body, /guard let value = field.value as\? String else \{ return false \}/)
    assert.match(body,/if visualText\("记一笔"\) == nil \{ activateWebContent\(\) \}/)
    assert.doesNotMatch(body, /typeText\(|field.tap\(|sleep\(/, '只验键盘就绪，不额外提交和清除搜索')
    const visible = source.slice(source.indexOf('private func tapVisibleText('), source.indexOf('private func appears('))
    assert.match(visible, /containing: Bool = false/)
    assert.match(visible, /self.visualText\(label, containing: containing\)/)
    const search = source.slice(source.indexOf('private func searchDictionary('), source.indexOf('private func dismissSearchKeyboard('))
    assert.match(search, /field.tap\(\)[\s\S]*XCTAssertTrue\(app.keyboards.firstMatch.waitForExistence\(timeout: 3\)\)[\s\S]*field.typeText\(text\)[\s\S]*dismissSearchKeyboard\(\)[\s\S]*expectValue\(field, text\)/)
    const dismissal = source.slice(source.indexOf('private func dismissNativeKeyboard()'), source.indexOf('private func dismissEntryKeyboard('))
    assert.match(dismissal, /let first = buttons.firstMatch[\s\S]*if first.exists && first.isHittable \{[\s\S]*done = first[\s\S]*return true[\s\S]*done = buttons.allElementsBoundByIndex.last\(where: \{ \$0.isHittable \}\)/)
    assert.match(dismissal, /XCTWaiter.wait\(for: \[ready\], timeout: 3\)[\s\S]*done\?\.tap\(\)[\s\S]*disappears\(app.keyboards.firstMatch\)/)
  }
  assertKeyboard(swift)
  const navigation = fs.readFileSync(new URL('../../app/src/components/BottomNavigation.vue', import.meta.url), 'utf8')
  assert.match(navigation, /page.title === '收支明细' \? '明细'/, '截图定位使用可见简称，不能误用 aria 名称')
  assert.throws(() => assertKeyboard(swift.replaceAll('tap("明细")', 'tap("收支明细")')))
  assert.throws(() => assertKeyboard(swift.replace('if visualText("记一笔") == nil { activateWebContent() }','activateWebContent()')))
  assert.throws(() => assertKeyboard(swift.replace('tapVisibleText("搜索账目", containing: true)', 'tapVisibleText("搜索账目")')))
  assert.throws(() => assertKeyboard(swift.replace('self.visualText(label, containing: containing)', 'self.visualText(label)')))
  assert.throws(() => assertKeyboard(swift.replace('XCTAssertTrue(keyboard.waitForExistence(timeout: 3)', 'XCTAssertTrue(true')))
  assert.throws(() => assertKeyboard(swift.replace('XCTAssertGreaterThan(keyboard.keys.count, 0,', 'XCTAssertGreaterThan(keyboard.keys.count, -1,')))
  assert.throws(() => assertKeyboard(swift.replace('        completeKeyboardIntroductionIfPresent()', '')))
  assert.throws(() => assertKeyboard(swift.replace('if visualText("Speed up your typing", containing: true) != nil {', 'if true {')))
  assert.throws(() => assertKeyboard(swift.replace('self.visualText("Speed up your typing", containing: true) == nil', 'true')))
  assert.throws(() => assertKeyboard(swift.replace('if first.exists && first.isHittable {', 'if first.exists {')))
  assert.throws(() => assertKeyboard(swift.replace('done = buttons.allElementsBoundByIndex.last(where: { $0.isHittable })', 'done = first')))
  assert.throws(() => assertKeyboard(swift.replace('guard let value = field.value as? String else { return false }', 'let value = field.value as? String ?? ""')))
  const save = swift.slice(swift.indexOf('func test15ExpensePrepareSave()'), swift.indexOf('func test15ExpenseRestart()'))
  assert.match(save, /tap\("保存支出"\)[\s\S]*appears\("刚刚保存"\)[\s\S]*appears\("测试苹果", containing: true\)[\s\S]*appears\("撤销"\)[\s\S]*app.terminate\(\)/)
  assert.throws(() => assertKeyboard(swift.replace('XCTWaiter.wait(for: [empty], timeout: 3)', 'XCTWaiter.wait(for: [], timeout: 3)')))
})
test('字典搜索完成原生编辑后精确回读，局部修改不作废收支与报表', () => {
  const swift=fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift',import.meta.url),'utf8')
  const start=swift.indexOf('private func searchDictionary('),end=swift.indexOf('private func dismissSearchKeyboard(')
  const helper=swift.slice(start,end)
  const check=source=>{
    assert.match(source,/field.tap\(\)[\s\S]*XCTAssertTrue\(app.keyboards.firstMatch.waitForExistence\(timeout: 3\)\)[\s\S]*field.typeText\(text\)[\s\S]*dismissSearchKeyboard\(\)[\s\S]*expectValue\(field, text\)/)
    assert.equal(source.match(/typeText\(text\)/g)?.length,1,'不能重放输入掩盖首次丢字')
  }
  check(helper)
  assert.throws(()=>check(helper.replace('dismissSearchKeyboard()','')))
  assert.throws(()=>check(helper.replace('expectValue(field, text)','')))
  assert.throws(()=>check(helper.replace('timeout: 3','timeout: 30')))
  const before=swift.slice(0,start)+helper.replace('        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))\n','')
    .replace(/        dismissSearchKeyboard\(\)\n        \/\/[^\n]*\n        expectValue\(field, text\)/,'        expectValue(field, text)\n        dismissSearchKeyboard()')+swift.slice(end)
  for(const name of ['test15ExpensePrepareSave','test15ExpenseRestart','test15ExpenseWriteReopen','test16IncomeAConfigure',
    'test16IncomeBSaveContinue','test16IncomeCFocusHandoff','test16IncomeContinueEdit','test23SaveThemePreference',
    'test37ReportTimeGrains','test37ReportTimeGrainsQuarterYear'])assert.equal(swiftCaseInput(swift,name),swiftCaseInput(before,name),name)
  assert.notEqual(swiftCaseInput(swift,'test19DisableTemplateUnit'),swiftCaseInput(before,'test19DisableTemplateUnit'))
})

test('T7 金额替换定位末尾并原生退格，双草稿覆盖零值和小数替换', () => {
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const validate = source => {
    const helper = source.slice(source.indexOf('private func replaceEntryField('), source.indexOf('private func dismissEntryKeyboard('))
    assert.match(helper, /guard let old = field.value as\? String/)
    assert.match(helper, /field.coordinate\(withNormalizedOffset: CGVector\(dx: 0.99, dy: 0.5\)\).tap\(\)[\s\S]*field.typeText\(String\(repeating: XCUIKeyboardKey.delete.rawValue, count: max\(1, old.count\)\)\)/)
    assert.match(helper, /field.tap\(\)[\s\S]*field.coordinate/)
    assert.match(helper, /old.count\)\)\)[\s\S]*field.typeText\(value\)[\s\S]*dismissEntryKeyboard\(\)[\s\S]*expectValue\(field, value\)/)
    assert.doesNotMatch(helper, /press\(forDuration:|Select All|全选|typeKey\(|evaluateJavaScript/)
    const draft = source.slice(source.indexOf('func test22PrepareDualDrafts()'), source.indexOf('func test23SaveThemePreference()'))
    assert.match(draft, /replaceEntryField\("expense-paid-amount", "实付金额", "0"\)[\s\S]*replaceEntryField\("expense-paid-amount", "实付金额", "77"\)/)
    assert.match(draft, /replaceEntryField\("income-amount", "收入金额", "1234.56"\)[\s\S]*replaceEntryField\("income-amount", "收入金额", "222"\)/)
    assert.match(draft, /XCUIDevice.shared.press\(\.home\)[\s\S]*app.terminate\(\)/)
  }
  validate(swift)
  for (const [before, after] of [
    ['CGVector(dx: 0.99, dy: 0.5)', 'CGVector(dx: 0.5, dy: 0.5)'],
    ['field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: max(1, old.count)))', ''],
    ['expectValue(field, value)', '']
  ]) {
    // 同样的末尾点按也用于搜索准备；反例必须删除被测金额辅助方法的步骤。
    const start = swift.indexOf('private func replaceEntryField(')
    const end = swift.indexOf('private func dismissEntryKeyboard(')
    const helper = swift.slice(start, end)
    assert.ok(helper.includes(before), '反例必须实际命中目标辅助方法')
    const broken = swift.slice(0, start) + helper.replace(before, after) + swift.slice(end)
    assert.throws(() => validate(broken), '缺少替换步骤或结果断言必须拒绝')
  }
})
for (const [type, key, invalid] of [['EXPENSE', 'paidAmount', '077'], ['INCOME', 'amount', '1234.56222']]) {
  test(`T7 双草稿回读拒绝 ${type} 旧金额残留、单类型和跨数据集结果`, t => {
    const selected = selection('--case', 'DictionaryUITests/DictionaryTouchTests/test22PrepareDualDrafts', [])
    assert.equal(selected.fixture, 'personal-22')
    assert.equal(selected.cases.length, 2, '只带目标与必要键盘前置')
    const { file, execute } = touchFixture(temporary(t))
    assert.equal(execute('debug-personal-22').status, 0)
    const db = new DatabaseSync(file)
    try {
      assert.equal(db.prepare('SELECT count(*) AS n FROM ledger_draft').get().n, 0, '夹具不预写被验收草稿')
      db.prepare("INSERT INTO ledger_meta VALUES(1,7,'draft-dataset',1,1,'2026-11-17','2026-11-17')").run()
      db.prepare("UPDATE preference SET value='\"INCOME\"' WHERE key='recentEntryType'").run()
      for (const [entryType, value] of [['EXPENSE', { paidAmount: '77' }], ['INCOME', { amount: '222' }]]) {
        db.prepare('INSERT INTO ledger_draft VALUES(?,?,1,?,?,?)').run('draft-dataset', entryType, JSON.stringify(value), '2026-11-17', '2026-11-17')
        if (entryType === 'EXPENSE') assert.notEqual(execute('debug-check-personal-22').status, 0, '缺收入草稿不能通过')
      }
      const verified = execute('debug-check-personal-22')
      assert.equal(verified.status, 0, verified.stderr)
      const update = db.prepare('UPDATE ledger_draft SET data_json=? WHERE entry_type=?')
      update.run(JSON.stringify({ [key]: invalid }), type)
      assert.notEqual(execute('debug-check-personal-22').status, 0, '拼接旧金额不能通过')
      update.run(JSON.stringify({ [key]: type === 'EXPENSE' ? '77' : '222' }), type)
      db.prepare("UPDATE ledger_draft SET dataset_id='other-dataset' WHERE entry_type=?").run(type)
      assert.notEqual(execute('debug-check-personal-22').status, 0, '另一数据集的草稿不能补足当前类型')
    } finally { db.close() }
  })
}
test('T8 夹具不预写调整，回读拒绝未执行清理和错误金额', (t) => {
  const { file, execute } = touchFixture(temporary(t))
  const prepared = execute('debug-lifecycle-26')
  assert.equal(prepared.status, 0, prepared.stderr)
  assert.notEqual(execute('debug-check-lifecycle-26').status, 0)
  const db = new DatabaseSync(file)
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM expense_adjustment').get().n, 0)
    db.prepare("DELETE FROM ledger_entry WHERE id='t8-expired'").run()
    db.prepare(`INSERT INTO expense_adjustment(id,original_expense_id,adjustment_type,amount_cents,business_time,business_date,created_at,updated_at)
      VALUES('synthetic-refund','t8-expense','REFUND',300,'2026-11-18T00:00:00Z','2026-11-18','2026-11-18','2026-11-18')`).run()
    const checked = execute('debug-check-lifecycle-26')
    assert.equal(checked.status, 0, checked.stderr)
    db.prepare("UPDATE expense_adjustment SET amount_cents=301 WHERE id='synthetic-refund'").run()
    assert.notEqual(execute('debug-check-lifecycle-26').status, 0)
  } finally { db.close() }
})
test('共享入口发现已有命令锁时拒绝执行，保留原归属记录', (t) => {
  const root = cliProject(t)
  const lock = path.join(root, '.local/ios/tmp/ai-agent/ios-command.lock')
  fs.mkdirSync(lock, { recursive: true })
  fs.writeFileSync(path.join(lock, 'owner.json'), 'existing-owner')
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/ios-app.mjs'), 'debug', 'create'], {
    encoding: 'utf8'
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /已有原生命令或遗留锁/)
  assert.equal(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'), 'existing-owner')
})
test('完整入口拒绝局部过滤，正常委托完整流程并释放锁', (t) => {
  const root = cliProject(t)
  const full = path.join(root, 'scripts/lib/ios-app-full.sh')
  fs.writeFileSync(full, '#!/bin/bash\nprintf FULL_GATE_EXECUTED\n')
  const run = (args) =>
    spawnSync(process.execPath, [path.join(root, 'scripts/ios-app.mjs'), ...args], { encoding: 'utf8' })
  const rejected = run(['ios-touch', '--case', 'test01'])
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /参数无效/)
  assert.doesNotMatch(rejected.stdout, /FULL_GATE_EXECUTED/)
  const accepted = run(['common'])
  assert.equal(accepted.status, 0)
  assert.match(accepted.stdout, /FULL_GATE_EXECUTED/)
  assert.equal(fs.existsSync(path.join(root, '.local/ios/tmp/ai-agent/ios-command.lock')), false)
})
test('完整入口仅允许受管会话借用设备；不接受过滤器或外部环境注入', (t) => {
  const root = cliProject(t)
  const full = path.join(root, 'scripts/lib/ios-app-full.sh')
  fs.writeFileSync(full, '#!/bin/bash\nprintf "FULL_SESSION=%s" "$MYBILL_FULL_SESSION"\n')
  const sessions = path.join(root, '.local/ios/tmp/ai-agent')
  fs.mkdirSync(sessions, { recursive: true })
  const directory = fs.mkdtempSync(path.join(sessions, 'ios-debug-'))
  const runId = randomUUID()
  const context = {
    schema: 1,
    kind: 'ios-debug',
    state: 'open',
    runId,
    simulatorId: randomUUID(),
    appId: APP_ID,
    name: `我的账单调试-${runId}`
  }
  const file = path.join(directory, 'test-context.json')
  fs.writeFileSync(file, JSON.stringify(context), { mode: 0o600 })
  const run = (args) =>
    spawnSync(process.execPath, [path.join(root, 'scripts/ios-app.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, MYBILL_FULL_SESSION: '/unmanaged' }
    })
  const normal = run(['common'])
  assert.equal(normal.status, 0)
  assert.equal(normal.stdout.split('\n')[0], 'FULL_SESSION=')
  const receipts = [...normal.stdout.matchAll(/^CI_RESULT=(.+)$/gm)]
  assert.equal(receipts.length, 1, '工程入口只输出一份独占一行的机器回执')
  const receipt = JSON.parse(fs.readFileSync(path.join(receipts[0][1], 'result.json'), 'utf8'))
  assert.equal(receipt.scope, 'engineering')
  assert.equal(receipt.status, 'passed')
  assert.equal(receipt.mode, 'common')
  const rejectedFull = run(['ios-touch', '--session', directory])
  assert.equal(rejectedFull.status, 1)
  assert.match(rejectedFull.stderr, /--from/)
  assert.doesNotMatch(rejectedFull.stdout, /FULL_SESSION=/)
  for (const args of [
    ['common', '--session', directory],
    ['ios-build', '--session', directory],
    ['ios-touch', '--session', directory, '--case', 'test01'],
    ['ios-touch', '--session', root]
  ]) {
    const result = run(args)
    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stdout, /FULL_SESSION=/)
  }
  fs.writeFileSync(file, JSON.stringify({ ...context, state: 'closed' }))
  assert.equal(run(['ios-touch', '--session', directory]).status, 1)
})
test('取消转发到本命令子进程，执行其退出清理并释放命令锁', { timeout: 30_000 }, async (t) => {
  const root = cliProject(t)
  fs.writeFileSync(
    path.join(root, 'scripts/lib/ios-app-full.sh'),
    `#!/bin/bash
trap 'echo done > cleanup-receipt; exit 143' TERM INT
echo ready > command-ready
while :; do sleep 1; done
`
  )
  const child = spawn(process.execPath, [path.join(root, 'scripts/ios-app.mjs'), 'common'], {
    stdio: 'ignore'
  })
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  })
  const exited = new Promise((resolve) => child.once('close', (code) => resolve(code)))
  for (let i = 0; i < 150 && !fs.existsSync(path.join(root, 'command-ready')); i++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(fs.existsSync(path.join(root, 'command-ready')))
  child.kill('SIGTERM')
  assert.equal(await exited, 143)
  assert.ok(fs.existsSync(path.join(root, 'cleanup-receipt')))
  assert.equal(fs.existsSync(path.join(root, '.local/ios/tmp/ai-agent/ios-command.lock')), false)
})
test('完整流程执行已校验快照，源脚本改写不影响运行且拒绝当前版本绿色', { timeout: 30_000 }, async (t) => {
  const root = cliProject(t)
  const file = path.join(root, 'scripts/lib/ios-app-full.sh')
  fs.writeFileSync(
    file,
    '#!/bin/bash\necho ready > snapshot-ready\nwhile [[ ! -f snapshot-release ]]; do sleep 0.05; done\n' +
      '# padding forces incremental Shell reads\n'.repeat(1000) +
      'printf ORIGINAL_SNAPSHOT\n'
  )
  const child = spawn(process.execPath, [path.join(root, 'scripts/ios-app.mjs'), 'common'])
  let output = ''
  let errors = ''
  child.stdout.on('data', (data) => {
    output += data
  })
  child.stderr.on('data', (data) => {
    errors += data
  })
  const exited = new Promise((resolve) => child.once('close', (code) => resolve(code)))
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM')
  })
  for (let i = 0; i < 150 && !fs.existsSync(path.join(root, 'snapshot-ready')); i++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(fs.existsSync(path.join(root, 'snapshot-ready')))
  assert.equal(child.exitCode, null)
  fs.writeFileSync(file, 'unterminated="')
  fs.writeFileSync(path.join(root, 'snapshot-release'), '')
  assert.equal(await exited, 1)
  assert.match(output, /ORIGINAL_SNAPSHOT/)
  assert.match(errors, /完整流程脚本在执行期间变化/)
  assert.equal(fs.existsSync(path.join(root, '.local/ios/tmp/ai-agent/ios-command.lock')), false)
})


test('T9 查询场景隔离，单用例不隐式携带其他页面验收', () => {
  assert.deepEqual(selection('--case', 'NativeTests/NativeSqliteTests/testOfflineLedgerQuery', []).cases,
    ['NativeTests/NativeSqliteTests/testOfflineLedgerQuery'])
  const selected = selection('--scenario', 'query-cycle', [])
  assert.equal(selected.fixture, 'query-31,32,33')
  assert.equal(selected.cases.length, 4)
  for (const [index, name] of [[31, 'test31LedgerPagingSearch'], [32, 'test32LedgerFilterReset'], [33, 'test33LedgerEditReturn'], [34, 'test34LedgerUnicodeInput'], [35, 'test35LedgerUnicodePaste']]) {
    const single = selection('--case', `DictionaryUITests/DictionaryTouchTests/${name}`, [])
    assert.equal(single.fixture, 'query-' + index)
    assert.equal(single.cases.length, 2)
  }
  const input = selection('--scenario', 'query-input', [])
  assert.equal(input.fixture, 'query-34,35')
  assert.deepEqual(input.cases, ['DictionaryUITests/DictionaryTouchTests/test00DebugKeyboardReady',
    'DictionaryUITests/DictionaryTouchTests/test34LedgerUnicodeInput', 'DictionaryUITests/DictionaryTouchTests/test35LedgerUnicodePaste'])
  const shell = fs.readFileSync(new URL('../lib/ios-app-full.sh', import.meta.url), 'utf8')
  for (const name of ['test31LedgerPagingSearch', 'test32LedgerFilterReset', 'test33LedgerEditReturn', 'test34LedgerUnicodeInput', 'test35LedgerUnicodePaste']) {
    assert.ok(shell.includes('-skip-testing:DictionaryUITests/DictionaryTouchTests/' + name))
    assert.ok(shell.includes('-only-testing:DictionaryUITests/DictionaryTouchTests/' + name))
  }
  assert.ok(shell.includes('prepare-query') && shell.includes('check-query'))
})
test('T9 查询夹具只准备输入，回读拒绝缺失编辑和额外写入', (t) => {
  const { file, execute } = touchFixture(temporary(t))
  const prepared = execute('debug-query-31,32,33')
  assert.equal(prepared.status, 0, prepared.stderr)
  assert.equal(execute('debug-check-query-31,32').status, 0)
  assert.notEqual(execute('debug-check-query-33').status, 0)
  const db = new DatabaseSync(file)
  try {
    db.prepare("UPDATE ledger_entry SET note='T9 edited',row_version=2,search_text='t9 edited' WHERE id='t9-query-00'").run()
    assert.equal(execute('debug-check-query-31,32,33').status, 0)
    db.prepare("UPDATE ledger_entry SET amount_cents=1 WHERE id='t9-query-01'").run()
    assert.notEqual(execute('debug-check-query-33').status, 0)
    assert.notEqual(execute('debug-query-31').status, 0, '已有账本不能覆盖重建')
  } finally { db.close() }
})

test('T9 Unicode 输入夹具独立回读，拒绝任何业务改写', (t) => {
  const { file, execute } = touchFixture(temporary(t))
  assert.equal(execute('debug-query-34,35').status, 0)
  assert.equal(execute('debug-check-query-34').status, 0)
  assert.equal(execute('debug-check-query-35').status, 0)
  assert.equal(execute('debug-check-query-34,35').status, 0)
  const db = new DatabaseSync(file)
  try {
    db.prepare("UPDATE ledger_entry SET note='unexpected',row_version=2 WHERE id='t9-query-00'").run()
    assert.notEqual(execute('debug-check-query-34,35').status, 0)
  } finally { db.close() }
})

test('T10 总览与时间场景隔离，CI 使用相同原生入口和只读回验', () => {
  assert.deepEqual(selection('--case', 'NativeTests/NativeSqliteTests/testOfflineCoreReports', []).cases, ['NativeTests/NativeSqliteTests/testOfflineCoreReports'])
  const selected = selection('--scenario', 'report-cycle', [])
  assert.equal(selected.fixture, 'report-42,36,41,37,40,38,39')
  assert.equal(selected.cases.length, 8)
  // XCTest 按方法名排序；五种粒度须先于改金额，组合与单用例使用相同 988.00 预期。
  const quarter = 'DictionaryUITests/DictionaryTouchTests/test37ReportTimeGrainsQuarterYear'
  const edit = 'DictionaryUITests/DictionaryTouchTests/test38ReportDrillReturn'
  assert.ok(selected.cases.indexOf(quarter) < selected.cases.indexOf(edit))
  assert.ok(quarter < edit)
  const shell = fs.readFileSync(new URL('../lib/ios-app-full.sh', import.meta.url), 'utf8')
  for (const [index, name] of [[36, 'test36ReportOverview'], [37, 'test37ReportTimeGrains'], [38, 'test38ReportDrillReturn'], [39, 'test39ReportComparison'], [40, 'test37ReportTimeGrainsQuarterYear']]) {
    const single = selection('--case', `DictionaryUITests/DictionaryTouchTests/${name}`, [])
    const preparation = index === 36 ? [42] : [42, 41]
    assert.equal(single.fixture, 'report-' + [...preparation, index].join(','))
    assert.deepEqual(single.cases, [
      ...(index === 38 ? ['DictionaryUITests/DictionaryTouchTests/test00DebugKeyboardReady'] : []),
      ...preparation.map(i => 'DictionaryUITests/DictionaryTouchTests/' + (i === 42 ? 'test00PrepareReportApp' : 'test36ReportTimePreparation')),
      `DictionaryUITests/DictionaryTouchTests/${name}`,
    ])
    assert.ok(shell.includes('-skip-testing:DictionaryUITests/DictionaryTouchTests/' + name))
    assert.ok(shell.includes('-only-testing:DictionaryUITests/DictionaryTouchTests/' + name))
  }
  assert.ok(shell.includes('prepare-report') && shell.includes('check-report'))
  assert.ok(shell.includes('/OFFLINE_CORE_REPORT_EVIDENCE/p'))
  const grains = selection('--scenario', 'report-grains', [])
  assert.equal(grains.fixture, 'report-42,41,37,40')
  assert.equal(grains.cases.length, 4)
  assert.ok(!grains.cases.some(name => name.endsWith('test00DebugKeyboardReady')))
  assert.ok(grains.cases[0].endsWith('test00PrepareReportApp'))
  assert.ok(grains.cases[1].endsWith('test36ReportTimePreparation'))
})

test('T10 组合验收按 XCTest 实际排序保持总览→时间准备→五粒度→编辑，拒绝旧准备名称', () => {
  const assertOrder = cases => {
    const ordered = [...cases].sort().map(name => name.split('/').at(-1))
    const preparation = ordered.find(name => /PrepareTimeReport|ReportTimePreparation/.test(name))
    const chain = ['test00PrepareReportApp', 'test36ReportOverview', preparation,
      'test37ReportTimeGrains', 'test37ReportTimeGrainsQuarterYear']
    if (ordered.includes('test38ReportDrillReturn')) chain.push('test38ReportDrillReturn', 'test39ReportComparison')
    assert.ok(chain.every(name => ordered.includes(name)), '缺少组合前置')
    assert.deepEqual(ordered.filter(name => chain.includes(name)), chain, 'XCTest 词典序破坏页面状态依赖')
  }
  const cycle = selection('--scenario', 'report-cycle', []).cases
  assertOrder(cycle)
  const prefix = selection('--scenario', 'report-overview-grains', [])
  assert.equal(prefix.fixture, 'report-42,36,41,37,40')
  assert.equal(prefix.cases.length, 5)
  assertOrder(prefix.cases)
  const shell = fs.readFileSync(new URL('../lib/ios-app-full.sh', import.meta.url), 'utf8')
  const reportLine = shell.split('\n').find(line => line.includes('positive_test "${RUN_DIRECTORY}/touch-report.log"'))
  const full = [...reportLine.matchAll(/-only-testing:([^ ]+)/g)].map(match => match[1])
  assertOrder(full)
  assert.deepEqual([...full].sort(), [...cycle].filter(name => !name.endsWith('test00DebugKeyboardReady')).sort())
  const broken = cycle.map(name => name.replace('test36ReportTimePreparation', 'test36PrepareTimeReport'))
  assert.throws(() => assertOrder(broken), /词典序/)
})

test('T10 原生粒度断言必须同时检查具体时段和结果可用，金额不能单独放行', () => {
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const predicate = swift.slice(swift.indexOf('private func verifyReportGrains('), swift.indexOf('func test37ReportTimeGrains()'))
  const assertFreshSnapshot = source => {
    assert.match(source, /period\.value as\? String == expected/)
    assert.match(source, /period\.isEnabled/)
    assert.match(source, /drill\.exists && drill\.isEnabled/)
    assert.match(source, /amounts\.count == 3/)
  }
  assertFreshSnapshot(predicate)
  for (const guard of ['period.value as? String == expected', 'period.isEnabled', 'drill.exists && drill.isEnabled']) {
    assert.throws(() => assertFreshSnapshot(predicate.replace(guard, 'true')), '拒绝只命中旧金额或禁用结果')
  }
})

test('T10 粒度期望与原生日期筛选共用绝对夹具，拒绝重新读取执行日期', () => {
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const assertFixedRange = source => {
    const grains = source.slice(source.indexOf('private func verifyReportGrains('), source.indexOf('func test37ReportTimeGrains()'))
    assert.match(grains, /let fixture = try reportFixture\(\)/)
    assert.match(grains, /XCTUnwrap\(fixture\.periods\[grain\]/)
    assert.doesNotMatch(grains, /Date\(\)|reportPeriodLabel/)
    assert.ok(source.includes('date: fixture.startDate'))
    assert.ok(source.includes('date: fixture.endDate'))
    assert.ok(source.includes('label: "日期范围", option: "指定日期"'))
  }
  assertFixedRange(swift)
  assert.throws(() => assertFixedRange(swift.replace('fixture.periods[grain]', 'reportPeriodLabel(grain, today: Date())')))
  for (const date of ['startDate', 'endDate']) {
    assert.throws(() => assertFixedRange(swift.replace('date: fixture.' + date, 'date: "2026-11-19"')))
  }
  const project = fs.readFileSync(new URL('../../app/ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8')
  const resources = project.slice(project.indexOf('C50000000000000000000009 /* Resources */ ='), project.indexOf('/* End PBXResourcesBuildPhase'))
  assert.match(resources, /reportTouchFixture.json in Resources/)
  assert.match(project, /path = ..\/..\/test-support\/reportTouchFixture.json/)
  const appResources = project.slice(project.indexOf('504EC3021FED79650016851F /* Resources */ ='), project.indexOf('A10000000000000000000009 /* Resources */ ='))
  assert.ok(appResources.includes('public in Resources'))
  assert.doesNotMatch(appResources, /reportTouchFixture/)
})

test('T10 原生日期控件选择实际输入并按固定年月跳过无效滚轮操作', () => {
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const helper = swift.slice(swift.indexOf('private func setReportDate('), swift.indexOf('private func reportFixtureScope()'))
  const assertDateInput = source => {
    assert.ok(source.includes('let fields = app.otherElements.matching('))
    assert.ok(source.includes('XCTUnwrap(fields.allElementsBoundByIndex.last)'))
    assert.ok(source.includes('if heading.value as? String != "\\(parts[0])年\\(parts[1])月"'))
    assert.ok(source.includes('year.adjust(toPickerWheelValue:'))
    assert.ok(source.includes('month.adjust(toPickerWheelValue:'))
    assert.doesNotMatch(source, /Date\(\)/)
  }
  assertDateInput(helper)
  assert.throws(() => assertDateInput(helper.replace('allElementsBoundByIndex.last', 'allElementsBoundByIndex.first')))
  assert.throws(() => assertDateInput(helper.replace('if heading.value as? String != "\\(parts[0])年\\(parts[1])月"', 'if false')))
})

test('T10 总览带符号、净支出下钻返回使用正金额的精确原生节点，不依赖通用 Any/OCR 后备', () => {
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const assertExactMoney = source => {
    const helper = source.slice(source.indexOf('private func expectReportAmount('), source.indexOf('func test36ReportOverview()'))
    assert.ok(helper.includes('app.staticTexts.matching(NSPredicate(format: "label == %@", label))'))
    assert.ok(helper.includes('amount.waitForExistence(timeout: 3)'))
    const overview = source.slice(source.indexOf('func test36ReportOverview()'), source.indexOf('func test00PrepareReportApp()'))
    for (const amount of ['+¥1,000', '-¥15', '+¥3', '-¥12', '+¥988']) assert.ok(overview.includes('"' + amount + '"'))
    assert.ok(overview.includes('expectReportAmount(amount)'))
    assert.doesNotMatch(overview, /appears\("¥/)
    const drill=source.slice(source.indexOf('func test38ReportDrillReturn()'),source.indexOf('func test00PrepareDimensionReport()'))
    assert.ok(drill.includes('let range = app.staticTexts["范围合计 ¥13"]'))
    assert.ok(drill.includes('app.staticTexts.matching(NSPredicate(format: "label == %@", "¥13"))'))
    assert.match(drill,/period.value as\? String == expected && period.isEnabled[\s\S]*drill.exists && drill.isEnabled && range.exists && amounts.count == 2/)
  }
  assertExactMoney(swift)
  for (const change of [source => source.replace('app.staticTexts.matching(NSPredicate(format: "label == %@", label))', 'app.descendants(matching: .any)'),
    source => source.replace('"+¥988"', '"¥988"'), source => source.replace('expectReportAmount(amount)', 'appears(amount)'),
    source => source.replace('"范围合计 ¥13"','"范围合计 -¥13"'),
    source => source.replace('amounts.count == 2','amounts.count >= 1')]) {
    assert.throws(() => assertExactMoney(change(swift)))
  }
})

test('T10 报表启动准备经原底栏激活并断言真实控件，不受页首提示遮挡', () => {
  const swift = fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift', import.meta.url), 'utf8')
  const assertReportReady = source => {
    assert.ok(source.includes('if !name.contains("test00PrepareReportApp")'))
    const warmup = source.slice(source.indexOf('func test00PrepareReportApp()'), source.indexOf('func test36ReportTimePreparation()'))
    assert.ok(warmup.includes('let report = app.links.matching('))
    assert.ok(warmup.includes('if report.waitForExistence(timeout: 10) { report.tap() }'))
    assert.ok(warmup.includes('tapVisibleText("报表")'))
    assert.doesNotMatch(warmup, /CGVector|web\.coordinate/)
    assert.ok(warmup.includes('"report-dimension", "维度"'))
    assert.ok(warmup.includes('XCTAssertTrue(dimension.waitForExistence(timeout: 3)'))
    assert.ok(warmup.includes('XCTAssertTrue(dimension.isEnabled)'))
    assert.doesNotMatch(warmup, /appears\("记一笔"/)
  }
  assertReportReady(swift)
  for (const guard of ['if report.waitForExistence(timeout: 10) { report.tap() }', 'tapVisibleText("报表")', 'XCTAssertTrue(dimension.waitForExistence(timeout: 3)', 'XCTAssertTrue(dimension.isEnabled)']) {
    assert.throws(() => assertReportReady(swift.replace(guard, '// omitted')))
  }
})

for (const before of ['2026-11-18T15:59:59Z', '2026-11-30T15:59:59Z', '2026-12-31T15:59:59Z']) {
  test(`T10 真实夹具准备/回验跨午夜、月/年边界 ${before} 仍使用绝对日期`, t => {
    const { file, execute } = touchFixture(temporary(t))
    const after = new Date(Date.parse(before) + 2000).toISOString()
    assert.equal(execute('debug-report-42,41,37,40', before).status, 0)
    assert.equal(execute('debug-check-report-42,41,37,40', after).status, 0)
    const fixture = JSON.parse(fs.readFileSync(new URL('../../app/test-support/reportTouchFixture.json', import.meta.url)))
    const db = new DatabaseSync(file)
    try {
      const dates = db.prepare("SELECT business_time,business_date FROM ledger_entry WHERE id LIKE 't10-%' UNION ALL SELECT business_time,business_date FROM expense_adjustment WHERE id='t10-refund'").all()
      assert.equal(dates.length, 3)
      for (const row of dates) assert.deepEqual({ ...row }, { business_time: fixture.occurredAt, business_date: fixture.endDate })
      db.prepare("UPDATE expense_adjustment SET business_date='2026-11-19' WHERE id='t10-refund'").run()
      assert.notEqual(execute('debug-check-report-37', after).status, 0, '拒绝调整日期漂移，即使金额/版本仍正确')
    } finally { db.close() }
  })
}
test('T10 夹具与其他阶段隔离，编辑用例必须且只能产生约定结果', t => {
  const { file, execute } = touchFixture(temporary(t))
  assert.equal(execute('debug-report-36,37,38,39').status, 0)
  assert.equal(execute('debug-check-report-36,37,39').status, 0)
  assert.notEqual(execute('debug-check-report-38').status, 0)
  const db = new DatabaseSync(file)
  try {
    const funding = db.prepare("SELECT funding_channel_id AS id FROM ledger_entry WHERE id='t10-income'").get().id
    assert.match(funding, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/)
    db.prepare("UPDATE ledger_entry SET amount_cents=1600,row_version=2 WHERE id='t10-expense'").run()
    assert.equal(execute('debug-check-report-36,37,38,39').status, 0)
    db.prepare("UPDATE expense_adjustment SET amount_cents=301 WHERE id='t10-refund'").run()
    assert.notEqual(execute('debug-check-report-38').status, 0)
    assert.notEqual(execute('debug-report-36').status, 0)
  } finally { db.close() }
})


test('T16 页面就绪与值同步保留原预算，诊断不以超时后的新读数伪装窗口内状态', () => {
  const swift=fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift',import.meta.url),'utf8')
  const check=source=>{
    const keyboard=source.slice(source.indexOf('func test00DebugKeyboardReady()'),source.indexOf('private func completeKeyboardIntroductionIfPresent()'))
    assert.match(keyboard,/appears\("记一笔", timeout: 20\)[\s\S]*tap\("明细"\)/)
    assert.match(keyboard,/if visualText\("记一笔"\) == nil \{ activateWebContent\(\) \}[\s\S]*appears\("记一笔", timeout: 20\)/)
    const helper=source.slice(source.indexOf('private func expectValue('),source.indexOf('private func openIndex('))
    assert.match(helper,/systemUptime \+ 3/)
    assert.match(helper,/guard start < deadline else \{ return false \}[\s\S]*let actual = field.value as\? String[\s\S]*return end <= deadline && actual == value/)
    assert.equal(helper.match(/field.value/g)?.length,1,'超时消息不得再次读取 AX 值')
    assert.match(helper,/object: nil/)
    assert.match(helper,/if matches.evaluate\(with: nil\) \{ return \}[\s\S]*let remaining = max\(0, deadline - ProcessInfo.processInfo.systemUptime\)/)
    assert.match(helper,/XCTWaiter.wait\(for: \[ready\], timeout: remaining\)/)
    assert.match(source,/executionTimeAllowance = 60/)
  }
  check(swift)
  const keyboardStart=swift.indexOf('func test00DebugKeyboardReady()'),keyboardEnd=swift.indexOf('private func completeKeyboardIntroductionIfPresent()')
  const oldKeyboard=swift.slice(0,keyboardStart)+swift.slice(keyboardStart,keyboardEnd).replace('tap("明细")','tapVisibleText("明细")')+swift.slice(keyboardEnd)
  for(const name of ['test15ExpensePrepareSave','test16IncomeCFocusHandoff','test23SaveThemePreference','test37ReportTimeGrains'])
    assert.equal(swiftCaseInput(swift,name),swiftCaseInput(oldKeyboard,name),'导航定位只影响键盘前置：'+name)
  assert.notEqual(swiftCaseInput(swift,'test00DebugKeyboardReady'),swiftCaseInput(oldKeyboard,'test00DebugKeyboardReady'))
  for(const changed of [swift.replaceAll('        appears("记一笔", timeout: 20)\n',''),
    swift.replace('return end <= deadline && actual == value','return actual == value'),
    swift.replace('actual == value','actual != nil'),swift.replace('timeout: remaining','timeout: 30'),
    swift.replace('窗口内最后观测 \\(observed)','窗口内最后观测 \\(field.value)')])assert.throws(()=>check(changed))
})

test('T11 多维下钻将精确计数滚入可见区，改动不使无关触摸输入失效', () => {
  const swift=fs.readFileSync(new URL('../../app/ios/App/UITests/DictionaryTouchTests.swift',import.meta.url),'utf8')
  const check=source=>{
    const body=source.slice(source.indexOf('private func verifyDimension('),source.indexOf('func test40ExpenseDimensionGroups()'))
    assert.match(body,/let summary = app.staticTexts\["已加载 \\\(count\) 笔"\]/)
    assert.match(body,/summary.waitForExistence\(timeout: 5\)[\s\S]*let bottom = navigation.frame.minY[\s\S]*for _ in 0\.\.<5[\s\S]*summary.frame.minY >= top && summary.frame.maxY <= bottom[\s\S]*app.webViews.firstMatch.swipeUp\(\)[\s\S]*XCTAssertTrue\(summary.frame.minY >= top && summary.frame.maxY <= bottom[\s\S]*XCTAssertEqual\(summary.label, "已加载 \\\(count\) 笔"\)/)
    assert.doesNotMatch(body,/revealReportRow\(summary\)/,'只读计数不能套用排行点击的固定底部余量')
  }
  check(swift)
  const changed=swift.replace('let bottom = navigation.frame.minY','let bottom = app.frame.maxY')
  assert.throws(()=>check(changed))
  assert.throws(()=>check(swift.replace('XCTAssertEqual(summary.label, "已加载 \\(count) 笔")','XCTAssertTrue(summary.exists)')))
  const consumers=new Set(['test40ExpenseDimensionGroups','test40ExpensePaymentChannels','test40ExpenseLocations',
    'test41ExpenseDimensionAnalysis','test41ExpenseFrequencyQuality','test42IncomeDimensions','test42IncomePayerName','test42IncomeFrequency'])
  for(const id of [...uiCases,'test00DebugKeyboardReady']) {
    const before=swiftCaseInput(swift,id),after=swiftCaseInput(changed,id)
    if(consumers.has(id))assert.notEqual(before,after,id)
    else assert.equal(before,after,'无关方法不受多维滚动改动影响：'+id)
  }
})

test('T11 多维单组/单用例共用原生入口，夹具隔离且回读拒绝分析改账', t => {
  assert.deepEqual(selection('--case','NativeTests/NativeSqliteTests/testOfflineDimensionReports',[]).cases,
    ['NativeTests/NativeSqliteTests/testOfflineDimensionReports'])
  const selected = selection('--scenario','report-dimensions',[])
  assert.equal(selected.cases.length,10)
  const remaining = selection('--scenario','report-dimension-details',[])
  assert.equal(remaining.cases.length,6)
  assert.ok(!remaining.cases.some(name => name.endsWith('test41ExpenseDimensionAnalysis')))
  const shell = fs.readFileSync(new URL('../lib/ios-app-full.sh',import.meta.url),'utf8')
  for(const name of ['test40ExpenseDimensionGroups','test41ExpenseDimensionAnalysis','test42IncomeDimensions','test43QualityThresholdDrill','test40ExpensePaymentChannels','test40ExpenseLocations','test41ExpenseFrequencyQuality','test42IncomePayerName','test42IncomeFrequency']) {
    const single = selection('--case','DictionaryUITests/DictionaryTouchTests/'+name,[])
    assert.equal(single.cases.length,2)
    assert.ok(single.cases[0].endsWith('test00PrepareDimensionReport'))
    assert.ok(shell.includes('-only-testing:DictionaryUITests/DictionaryTouchTests/'+name))
    assert.ok(shell.includes('-skip-testing:DictionaryUITests/DictionaryTouchTests/'+name))
  }
  assert.ok(shell.includes('prepare-dimensions') && shell.includes('check-dimensions'))
  const { file,execute } = touchFixture(temporary(t))
  const prepared = execute('debug-'+selected.fixture)
  assert.equal(prepared.status,0,prepared.stderr)
  assert.equal(execute('debug-check-'+selected.fixture).status,0)
  const db = new DatabaseSync(file)
  try {
    const samples = db.prepare("SELECT id,unit_id FROM ledger_entry WHERE product_name_snapshot LIKE '报表%' AND id<>'t10-expense'").all()
    assert.equal(samples.length,9)
    for(const row of samples) {
      assert.match(row.id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
      assert.match(row.unit_id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/)
    }
    db.prepare("UPDATE ledger_entry SET note='分析不应改账' WHERE amount_cents=1501 AND product_name_snapshot='报表苹果'").run()
    assert.notEqual(execute('debug-check-'+selected.fixture).status,0)
  } finally {db.close()}
})

test('T12 局部文件场景只补必要前置，完整触摸必须实际登记且回读不可省略', t => {
  const all = selection('--scenario','data-cycle',[])
  assert.equal(all.fixture,'data-53,60,54,55,56,57,58,59')
  assert.equal(all.cases.length,9)
  assert.equal(selection('--case','DictionaryUITests/DictionaryTouchTests/test45DataBackupSave',[]).cases.length,3)
  assert.deepEqual(selection('--case','DictionaryUITests/DictionaryTouchTests/test48DataRestoreConfirm',[]).cases,
    ['test00DebugKeyboardReady','test45DataBackupCancel','test45DataBackupSave','test47DataRestorePreviewCancel','test48DataRestoreConfirm'].map(name=>'DictionaryUITests/DictionaryTouchTests/'+name))
  const shell = fs.readFileSync(new URL('../lib/ios-app-full.sh',import.meta.url),'utf8')
  for(const name of all.cases.filter(name=>!name.endsWith('test00DebugKeyboardReady'))) {
    assert.ok(shell.includes('-only-testing:'+name))
    assert.ok(shell.includes('-skip-testing:'+name))
  }
  assert.ok(shell.indexOf('prepare-data') > shell.indexOf('check-dimensions'))
  const capture='python3 scripts/fixtures/dictionary-touch.py capture-data-defaults "${APP_CONTAINER}" "${SIMULATOR_ID}" "${RUN_DIRECTORY}/touch-data-fixture.json"'
  assert.ok(shell.indexOf(capture)>=0 && shell.indexOf(capture)<shell.indexOf('dictionary-touch.py prepare "'))
  assert.ok(shell.indexOf('check-data') > shell.indexOf('touch-data.log'))
  assert.equal(selection('--case','NativeTests/NativeSqliteTests/testOfflineDataManagement',[]).cases.length,1)
  assert.equal(selection('--case','NativeTests/NativeSqliteTests/testDataFileSecurityAndSwitchRecovery',[]).cases.length,1)
  const {file, execute} = touchFixture(temporary(t))
  const init = new DatabaseSync(file)
  try { init.prepare('INSERT INTO ledger_meta VALUES(1,8,?,1,1,?,?)').run(randomUUID(),'2026-11-21T01:00:00Z','2026-11-21T01:00:00Z') }
  finally {init.close()}
  const prepared = execute('debug-data-54')
  assert.equal(prepared.status,0,prepared.stderr)
  const db = new DatabaseSync(file)
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ledger_draft').get().n,2)
    for(const row of db.prepare('SELECT data_json FROM ledger_draft').all()) assert.match(JSON.parse(row.data_json).occurredAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM expense_adjustment').get().n,1)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ledger_entry WHERE lifecycle_status='TRASHED'").get().n,1)
    assert.notEqual(execute('debug-check-data-54').status,0,'没有实际外部文件不能伪称保存通过')
    assert.notEqual(execute('debug-data-54').status,0,'重复准备拒绝覆盖，不复用上一轮变更账本')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ledger_entry WHERE id LIKE 't10-%' OR id LIKE 't7-%'").get().n,0)
  } finally {db.close()}
})

test('T12 完整触摸沿用业务操作前的默认参照，清空回读拒绝字典和偏好残留', t => {
  const {file,execute}=touchFixture(temporary(t))
  const init=new DatabaseSync(file)
  init.prepare('INSERT INTO ledger_meta VALUES(1,8,?,1,1,?,?)').run(randomUUID(),'2026-11-21','2026-11-21')
  init.close()
  const initial=fs.readFileSync(file),receipt=path.join(path.dirname(path.dirname(path.dirname(file))),'fixture.json')
  const captured=execute('capture-data-defaults')
  assert.equal(captured.status,0,captured.stderr)
  const defaults=JSON.parse(fs.readFileSync(receipt)).clearDefaults
  const earlier=new DatabaseSync(file)
  earlier.prepare("INSERT INTO preference VALUES('theme','\"DARK\"') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  earlier.prepare("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,'PAYER','先前阶段','先前阶段','ACTIVE')").run(randomUUID())
  earlier.close()
  assert.notEqual(execute('capture-data-defaults').status,0,'已有参照不得被业务终态覆盖')
  const prepared=execute('debug-data-58')
  assert.equal(prepared.status,0,prepared.stderr)
  assert.deepEqual(JSON.parse(fs.readFileSync(receipt)).clearDefaults,defaults)
  fs.writeFileSync(file,initial)
  const clear=new DatabaseSync(file)
  clear.prepare('UPDATE ledger_meta SET dataset_id=?').run(randomUUID())
  clear.close()
  const valid=fs.readFileSync(file),container=path.dirname(path.dirname(path.dirname(file)))
  fs.mkdirSync(path.join(container,'Documents'),{recursive:true})
  fs.writeFileSync(path.join(container,'Documents/T12-backup-proof.mybill'),'MYBILL-BACKUP-1\nfixture')
  assert.equal(execute('debug-check-data-58').status,0)
  for(const sql of ["UPDATE dictionary_item SET name='残留',normalized_name='残留' WHERE name='工资'",
    "INSERT INTO preference VALUES('residual','true')"]) {
    const db=new DatabaseSync(file);db.exec(sql);db.close()
    const before=fs.readFileSync(file)
    assert.notEqual(execute('debug-check-data-58').status,0)
    assert.deepEqual(fs.readFileSync(file),before)
    fs.writeFileSync(file,valid)
  }
})

test('容量冷启动自动化失败保留同一设备恢复需求，成功冷启动解除',async t => {
  const root = temporary(t)
  for (const [index,status] of ['failed','passed'].entries()) {
    await new Promise(resolve => setTimeout(resolve,5))
    const run = path.join(root,'run-Cold'+index); fs.mkdirSync(run)
    fs.writeFileSync(path.join(run,'capacity-cold.log'),'cold')
    fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({ status }))
    assert.equal(needsSimulatorRecovery(root),status !== 'passed')
  }
})
