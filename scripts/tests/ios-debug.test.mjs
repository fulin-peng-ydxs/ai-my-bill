import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { spawn, spawnSync } from 'node:child_process'
import {
  APP_ID,
  RUNTIME,
  DEVICE_TYPE,
  selection,
  readSession,
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
    'scripts/lib/ios-debug.mjs',
    'scripts/lib/ios-verification.mjs',
    'scripts/lib/ios-checks.mjs',
    'app/native-tests/scenarios.json'
  ]) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(new URL('../../' + file, import.meta.url), target)
  }
  return root
}
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
    'test05CreateFunding',
    'test15ExpenseWriteReopen',
    'test16IncomeContinueEdit'
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
test('UI 局部夹具拒绝已有数据；准备改名/恢复/末页前置，回读拒绝未执行或历史被改写', (t) => {
  const root = temporary(t)
  for (const selected of [2, 7, 12, 14, 15, 16]) {
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
      for (const name of ['0001_initial.sql', '0002_dictionary_governance.sql', '0003_ledger_writes.sql'])
        database.exec(
          fs.readFileSync(new URL('../../app/src/data/migrations/' + name, import.meta.url), 'utf8')
        )
      for (let i = 0; i < 8; i++)
        database
          .prepare(
            "INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES(?,'INCOME_CATEGORY',?,?,'ACTIVE')"
          )
          .run(`61000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, i === 0 ? '工资' : '收入' + i, i === 0 ? '工资' : '收入' + i)
    } finally {
      database.close()
    }
    const receipt = path.join(container, 'fixture.json')
    const execute = (mode) =>
      spawnSync('python3', ['scripts/fixtures/dictionary-touch.py', mode, container, device, receipt], {
        encoding: 'utf8'
      })
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
        if (selected === 15) {
          check.prepare(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
            product_id,product_name_snapshot,unit_id,unit_name_snapshot,unit_price_scaled,quantity_scaled,calculated_amount_cents)
            VALUES('t6-saved','EXPENSE',1500,'t6-funding','测试现金','2026-11-17T01:00:00.000Z','2026-11-17','t6-product','测试苹果','t6-unit','斤',123456,1250,1543)`).run()
        } else {
          check.prepare(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
            income_name,payer_id,payer_name_snapshot,note,row_version) VALUES('t6-saved','INCOME',100000,'t6-funding','测试现金',
            '2026-11-17T01:00:00.000Z','2026-11-17','测试工资','t6-payer','合成公司','T6 edited',2)`).run()
        }
        assert.equal(execute('debug-check-' + selected).status, 0, '必须回读真实金额/名称/版本/类型字段')
        check.prepare("UPDATE ledger_entry SET amount_cents=1 WHERE id='t6-saved'").run()
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
  assert.equal(normal.stdout, 'FULL_SESSION=')
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
