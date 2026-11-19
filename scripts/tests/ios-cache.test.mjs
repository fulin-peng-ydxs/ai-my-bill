import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { cachedLayer, layerInputs, installationMatches, readInstallationLease } from '../lib/ios-cache.mjs'
import { APP_ID, hashPaths } from '../lib/ios-debug.mjs'
import { ciValidationScope } from '../lib/ios-ci.mjs'

function temporary(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ios-cache-test-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
function write(root, file, value = 'original') {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value, { mode: 0o600 })
  return target
}

test('CI 按场景选择：纯验证脚本双平台回归，App/构建依赖/手动候选保留完整门禁', () => {
  const scripts = ['scripts/lib/ios-cache.mjs', 'scripts/ios-app.mjs', 'scripts/fixtures/ios-ui-baseline.py',
    'scripts/tests/ios-cache.test.mjs', '.github/workflows/offline-ios.yml', 'agent-works/testing/guide.md',
    'agent-works/offline-ios-app/plan.md', 'README.md']
  assert.deepEqual(ciValidationScope(scripts), { common: 'scripts', native: false })
  for (const file of ['app/src/view.vue', 'app/ios/App/UITests/Test.swift', 'app/package-lock.json',
    '.nvmrc', 'package.json', 'DESIGN.md', 'scripts/toolchain.sh', 'scripts/normalize-capacitor-spm.mjs', 'unknown'])
    assert.deepEqual(ciValidationScope([...scripts, file]), { common: 'app', native: true }, file)
  assert.equal(ciValidationScope([]).native, true, '不能确定基线时不缩小')
  assert.equal(ciValidationScope(scripts, true).native, true, '手动完整候选不能被文件过滤跳过')
})

test('CI 分流实际入口读取 Git 变更；PR/push 同源，未知基线及手动执行不缩小', t => {
  const root = temporary(t)
  const git = write(root, 'bin/git', '#!/bin/sh\nprintf "scripts/lib/ios-cache.mjs\\0"\n')
  fs.chmodSync(git, 0o755)
  const eventFile = write(root, 'event.json', '{}'), output = path.join(root, 'output')
  for (const [name, event, native, missing] of [
    ['push', { before: 'a'.repeat(40) }, false],
    ['pull_request', { pull_request: { base: { sha: 'b'.repeat(40) } } }, false],
    ['push', { before: '0'.repeat(40) }, true],
    ['workflow_dispatch', { before: 'a'.repeat(40) }, true],
    ['push', { before: 'a'.repeat(40) }, true, true]
  ]) {
    fs.writeFileSync(git, missing ? '#!/bin/sh\nexit 1\n' : '#!/bin/sh\nprintf "scripts/lib/ios-cache.mjs\\0"\n')
    fs.writeFileSync(eventFile, JSON.stringify(event))
    fs.rmSync(output, { force: true })
    const result = spawnSync(process.execPath, [new URL('../lib/ios-ci.mjs', import.meta.url).pathname], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
        GITHUB_EVENT_PATH: eventFile, GITHUB_EVENT_NAME: name, GITHUB_OUTPUT: output }
    })
    assert.equal(result.status, 0, result.stderr)
    if (missing) assert.match(result.stderr, /保留完整门禁/)
    assert.match(fs.readFileSync(output, 'utf8'), new RegExp(`native=${native}\\n`))
  }
})

test('分层缓存命中与失效按真实依赖传播，Swift/脚本/测试修改不重打前端', t => {
  const root = temporary(t)
  const files = ['app/src/view.vue', 'app/src/view.spec.ts', 'app/native-tests/probe.ts',
    'app/test-support/scenario.ts', 'app/test-support/reportTouchFixture.json',
    'app/ios/App/UITests/Test.swift', 'app/ios/App/App/AppDelegate.swift',
    'app/ios/App/App.xcodeproj/project.pbxproj', 'app/ios/App/Package.resolved',
    'app/package.json', 'app/package-lock.json', 'app/index.html', 'app/public/icon.svg',
    'app/capacitor.config.ts', 'app/vite.config.ts', 'app/tsconfig.json',
    'app/tsconfig.tools.json', 'app/vitest.config.ts', 'scripts/normalize-capacitor-spm.mjs',
    'scripts/fixtures/dictionary-touch.py']
  files.forEach(file => write(root, file))
  const selected = { scheme: 'DictionaryTouch', configuration: 'Release' }
  const hashes = () => layerInputs(root, 'toolchain', selected, { assets: 'assets', probe: 'probe' })
  const original = hashes()
  for (const [file, changed] of [
    ['app/ios/App/UITests/Test.swift', ['native']],
    ['app/ios/App/App/AppDelegate.swift', ['native']],
    ['app/ios/App/App.xcodeproj/project.pbxproj', ['native']],
    ['app/ios/App/Package.resolved', ['native']],
    ['app/src/view.vue', ['types', 'assets', 'probe']],
    ['app/src/view.spec.ts', ['types']],
    ['app/native-tests/probe.ts', ['types', 'probe']],
    ['app/test-support/reportTouchFixture.json', ['types', 'probe', 'native']],
    ['app/public/icon.svg', ['assets']],
    ['app/index.html', ['assets']],
    ['app/package-lock.json', ['types', 'assets', 'probe']],
    ['app/tsconfig.json', ['types', 'assets', 'probe']],
    ['app/tsconfig.tools.json', ['types']],
    ['scripts/normalize-capacitor-spm.mjs', ['assets']],
    ['scripts/fixtures/dictionary-touch.py', []]
  ]) {
    const target = path.join(root, file), stat = fs.statSync(target)
    fs.writeFileSync(target, 'changed')
    fs.utimesSync(target, stat.atime, stat.mtime)
    const next = hashes()
    assert.deepEqual(Object.keys(original).filter(k => original[k] !== next[k]), changed, file)
    fs.writeFileSync(target, 'original')
  }
  fs.rmSync(path.join(root, 'app/public/icon.svg'))
  assert.notEqual(hashes().assets, original.assets, '删除输入失效')
  assert.notEqual(layerInputs(root, 'new-toolchain', selected).types, original.types)
  assert.notEqual(layerInputs(root, 'toolchain', selected, { assets: 'new-assets' }).native, original.native)
  assert.equal(layerInputs(root, 'toolchain', selected, { assets: 'assets', probe: 'new-probe' }).native, original.native,
    'UI target 不消费 hosted 探针')
  assert.notEqual(layerInputs(root, 'toolchain', { scheme: 'App', configuration: 'Debug' },
    { assets: 'assets', probe: 'new-probe' }).native,
  layerInputs(root, 'toolchain', { scheme: 'App', configuration: 'Debug' },
    { assets: 'assets', probe: 'probe' }).native)
})

test('缓存只认成功产物：缺失/篡改/依赖变化失效，失败和混合版本不写回执', async t => {
  const root = temporary(t)
  let input = 'A', builds = 0
  const run = (options = {}) => cachedLayer({ root, directory: root, name: 'assets', input: () => input,
    outputs: ['output'], build: async () => { builds++; write(root, 'output', input) }, ...options })
  assert.equal((await run()).hit, false)
  assert.equal((await run()).hit, true)
  assert.equal(builds, 1)
  fs.writeFileSync(path.join(root, 'output'), 'tampered')
  assert.equal((await run()).hit, false)
  fs.rmSync(path.join(root, 'output'))
  assert.equal((await run()).hit, false)
  input = 'B'
  assert.equal((await run()).hit, false)
  assert.equal((await run({ force: true })).hit, false, '故障目标不能仅凭缓存修复')
  await assert.rejects(run({ force: true, build: async () => { throw new Error('failed') } }))
  assert.equal(fs.existsSync(path.join(root, 'layer-assets.json')), false)
  assert.equal((await run()).hit, false)
  await assert.rejects(run({ force: true, build: async () => { input = 'C' } }), /输入变化/)
  assert.equal(fs.existsSync(path.join(root, 'layer-assets.json')), false)
  await assert.rejects(run({ outputs: ['missing'], build: async () => {} }), /不完整/)
})

test('原生失败只撤销对应层，局部修复恢复命中且安装包与 runner 独立核验', async t => {
  const root = temporary(t), builds = { assets: 0, native: 0 }
  const run = (name, force = false, fail = false) => cachedLayer({ root, directory: root, name,
    input: () => 'same', outputs: [name], force, build: async () => {
      builds[name]++
      if (fail) throw new Error('native failure')
      write(root, name)
    } })
  await run('assets'); await run('native')
  await assert.rejects(run('native', true, true))
  assert.equal((await run('assets')).hit, true)
  assert.equal((await run('native')).hit, false)
  assert.equal((await run('native')).hit, true)
  assert.equal(builds.assets, 1)
  for (const bundle of ['built/App', 'installed/App', 'built/Runner', 'installed/Runner']) write(root, bundle + '/binary')
  const match = name => installationMatches(path.join(root, 'built', name), path.join(root, 'installed', name))
  assert.equal(match('App'), true); assert.equal(match('Runner'), true)
  write(root, 'installed/Runner/binary', 'old runner')
  assert.equal(match('App'), true); assert.equal(match('Runner'), false)
  assert.equal(installationMatches(path.join(root, 'built/App'), undefined), false)
})

function baselineFixture(t) {
  const root = temporary(t), runId = randomUUID(), simulatorId = randomUUID()
  const session = path.join(root, '.local/ios/tmp/ai-agent/ios-debug-Cache')
  const container = path.join(root, 'CoreSimulator/Devices', simulatorId,
    'data/Containers/Data/Application', randomUUID())
  const file = write(root, path.relative(root, path.join(container, 'Library/OfflineLedger/ledgerSQLite.db')), '')
  const db = new DatabaseSync(file)
  for (const name of ['0001_initial.sql', '0002_dictionary_governance.sql', '0003_ledger_writes.sql',
    '0004_snapshot_search.sql', '0005_personal_state.sql', '0006_adjustment_lifecycle.sql', '0007_ledger_query.sql'])
    db.exec(fs.readFileSync(new URL('../../app/src/data/migrations/' + name, import.meta.url), 'utf8'))
  for (let i = 0; i < 8; i++) db.prepare(`INSERT INTO dictionary_item(id,kind,name,normalized_name,status,seed_key,seed_version)
    VALUES(?,'INCOME_CATEGORY',?,?,'ACTIVE',?,1)`).run(
    `61000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    i === 0 ? '工资' : '收入' + i, i === 0 ? '工资' : '收入' + i, 'seed-' + i)
  db.prepare('INSERT INTO ledger_meta VALUES(1,7,?,1,1,?,?)').run(randomUUID(), '2026-11-19', '2026-11-19')
  db.exec(`INSERT INTO preference VALUES('theme','"system"') ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
  db.close()
  const context = { schema: 1, kind: 'ios-debug', state: 'open', runId, simulatorId,
    appId: APP_ID, name: '我的账单调试-' + runId }
  const contextFile = write(root, path.relative(root, path.join(session, 'test-context.json')), JSON.stringify(context))
  const appHash = 'a'.repeat(64)
  const lease = { runId, simulatorId, appId: APP_ID, container, appHash }
  const leaseFile = write(root, path.relative(root, path.join(session, 'ui-install.json')), JSON.stringify(lease))
  const script = new URL('../fixtures/ios-ui-baseline.py', import.meta.url).pathname
  const execute = (mode, overrides = {}) => spawnSync('python3',
    [script, mode, contextFile, overrides.container ?? container, overrides.appHash ?? appHash], { cwd: root, encoding: 'utf8' })
  const fixture = mode => spawnSync('python3', [new URL('../fixtures/dictionary-touch.py', import.meta.url).pathname,
    mode, container, simulatorId, path.join(session, 'fixture.json')], { cwd: root, encoding: 'utf8' })
  return { root, session, context, contextFile, container, file, execute, fixture, leaseFile, lease, script, appHash }
}

test('UI 基线安全复用：重复和跨场景均从空账本重铺，偏好/草稿/内部快照隔离', t => {
  const p = baselineFixture(t)
  let result = p.execute('capture')
  assert.equal(result.status, 0, result.stderr)
  const original = fs.readFileSync(path.join(p.session, 'ui-baseline/ledgerSQLite.db'))
  const sentinel = write(p.root, path.relative(p.root, path.join(p.container, 'Documents/keep')), 'outside scope')
  for (const mode of ['debug-personal-22', 'debug-query-31', 'debug-report-42', 'debug-report-42']) {
    result = p.fixture(mode)
    assert.equal(result.status, 0, result.stderr)
    const db = new DatabaseSync(p.file)
    db.exec(`UPDATE preference SET value='"dark"'; INSERT INTO maintenance_state VALUES('leftover','{}')`)
    db.exec(`INSERT INTO ledger_draft SELECT dataset_id,'INCOME',1,'{}','2026-11-19','2026-11-19' FROM ledger_meta`)
    db.close()
    write(p.root, path.relative(p.root, path.join(path.dirname(p.file), 'snapshots/internal.db')), 'synthetic old snapshot')
    assert.equal(p.execute('capture').status, 1, '拒绝用已有终态覆盖基线')
    result = p.execute('restore')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(fs.readFileSync(p.file), original)
    assert.deepEqual(fs.readdirSync(path.dirname(p.file)), ['ledgerSQLite.db'])
    const clean = new DatabaseSync(p.file)
    assert.equal(clean.prepare('SELECT count(*) AS n FROM ledger_entry').get().n, 0)
    assert.equal(clean.prepare('SELECT count(*) AS n FROM ledger_draft').get().n, 0)
    assert.equal(clean.prepare('SELECT count(*) AS n FROM maintenance_state').get().n, 0)
    assert.equal(clean.prepare("SELECT value FROM preference WHERE key='theme'").get().value, '"system"')
    clean.close()
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside scope')
  }
})

test('UI 基线拒绝污染初态、错误安装/会话/沙盒、篡改和符号链接，拒绝时不改现有数据', t => {
  for (const kind of ['dirty', 'draft', 'app', 'session', 'container', 'dataset', 'tamper', 'symlink']) {
    const p = baselineFixture(t)
    if (kind === 'dirty' || kind === 'draft') {
      const db = new DatabaseSync(p.file)
      db.exec(kind === 'dirty'
        ? `INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES('custom','UNIT','custom','custom','ACTIVE')`
        : `INSERT INTO ledger_draft SELECT dataset_id,'EXPENSE',1,'{}','2026-11-19','2026-11-19' FROM ledger_meta`)
      db.close()
      assert.notEqual(p.execute('capture').status, 0)
      continue
    }
    assert.equal(p.execute('capture').status, 0)
    if (kind === 'dataset') {
      const db = new DatabaseSync(p.file)
      db.prepare('UPDATE ledger_meta SET dataset_id=?').run(randomUUID())
      db.close()
    }
    const before = hashPaths(path.dirname(p.file), ['.'])
    if (kind === 'app') assert.notEqual(p.execute('restore', { appHash: 'b'.repeat(64) }).status, 0)
    if (kind === 'session') {
      fs.writeFileSync(p.contextFile, JSON.stringify({ ...p.context, runId: randomUUID() }))
      assert.notEqual(p.execute('restore').status, 0)
    }
    if (kind === 'container') {
      fs.writeFileSync(p.leaseFile, JSON.stringify({ ...p.lease, container: '/other' }))
      assert.notEqual(p.execute('restore').status, 0)
    }
    if (kind === 'dataset') assert.notEqual(p.execute('restore').status, 0)
    if (kind === 'tamper') {
      fs.appendFileSync(path.join(p.session, 'ui-baseline/ledgerSQLite.db'), 'tampered')
      assert.notEqual(p.execute('restore').status, 0)
    }
    if (kind === 'symlink') {
      fs.symlinkSync(p.file, path.join(path.dirname(p.file), 'unexpected-link'))
      assert.notEqual(p.execute('restore').status, 0)
      fs.unlinkSync(path.join(path.dirname(p.file), 'unexpected-link'))
    }
    assert.equal(hashPaths(path.dirname(p.file), ['.']), before, kind)
  }
})

test('XCTest 沙盒搬迁只重绑同一包和数据集，拒绝跨设备/数据集且不重铺终态', t => {
  const p = baselineFixture(t)
  assert.equal(p.execute('capture').status, 0)
  assert.equal(p.fixture('debug-report-42').status, 0)
  const moved = path.join(path.dirname(p.container), randomUUID())
  fs.cpSync(p.container, moved, { recursive: true })
  const file = path.join(moved, 'Library/OfflineLedger/ledgerSQLite.db')
  const before = fs.readFileSync(file)
  assert.notEqual(p.execute('restore', { container: moved }).status, 0, '未重绑路径拒绝恢复')
  let result = p.execute('rebind', { container: moved })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fs.readFileSync(file), before, '重绑不改业务终态')
  assert.equal(JSON.parse(fs.readFileSync(p.leaseFile)).container, moved)
  result = p.execute('restore', { container: moved })
  assert.equal(result.status, 0, result.stderr)
  const db = new DatabaseSync(file)
  db.prepare('UPDATE ledger_meta SET dataset_id=?').run(randomUUID())
  db.close()
  assert.notEqual(p.execute('rebind', { container: moved }).status, 0)
  const otherDevice = moved.replace(p.context.simulatorId, randomUUID())
  fs.mkdirSync(path.dirname(otherDevice), { recursive: true })
  fs.cpSync(moved, otherDevice, { recursive: true })
  assert.notEqual(p.execute('rebind', { container: otherDevice }).status, 0)
})

test('损坏或跨会话安装回执拒绝降级重装，缺失才允许首次安装', t => {
  const p = baselineFixture(t), session = { directory: p.session, context: p.context }
  assert.deepEqual(readInstallationLease(session), p.lease)
  for (const patch of [{ runId: randomUUID() }, { simulatorId: randomUUID() }, { appId: 'other.app' },
    { appHash: 'invalid' }, { container: 'relative' }]) {
    fs.writeFileSync(p.leaseFile, JSON.stringify({ ...p.lease, ...patch }))
    assert.throws(() => readInstallationLease(session))
  }
  fs.writeFileSync(p.leaseFile, '{broken')
  assert.throws(() => readInstallationLease(session))
  fs.writeFileSync(p.leaseFile, JSON.stringify(p.lease))
  fs.chmodSync(p.leaseFile, 0o644)
  assert.throws(() => readInstallationLease(session))
  fs.unlinkSync(p.leaseFile)
  assert.equal(readInstallationLease(session), undefined)
  fs.symlinkSync(path.join(p.session, 'missing'), p.leaseFile)
  assert.throws(() => readInstallationLease(session), '悬空链接也不能视为无回执')
})

test('UI 基线替换失败回滚旧目录，不发布半份账本或留下重置目录', t => {
  const p = baselineFixture(t)
  assert.equal(p.execute('capture').status, 0)
  assert.equal(p.fixture('debug-report-42').status, 0)
  const original = hashPaths(path.dirname(p.file), ['.'])
  const result = spawnSync('python3', ['-c', `
import runpy, sys
from pathlib import Path
module = runpy.run_path(sys.argv[1])
original = Path.rename
def fail(self, target):
    if self.name.startswith('offline-reset-'): raise OSError('controlled replacement failure')
    return original(self, target)
Path.rename = fail
module['run']('restore', *sys.argv[2:])
`, p.script, p.contextFile, p.container, p.appHash], { cwd: p.root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /controlled replacement failure/)
  assert.equal(hashPaths(path.dirname(p.file), ['.']), original)
  assert.deepEqual(fs.readdirSync(path.join(p.container, 'Library')), ['OfflineLedger'])
})
