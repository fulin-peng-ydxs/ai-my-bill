import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { cachedLayer, layerInputs, installationMatches, readInstallationLease,
  inspectInstallation, recordInstallation, forgetInstallation } from '../lib/ios-cache.mjs'
import { APP_ID, hashPaths } from '../lib/ios-debug.mjs'

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

test('SPM 干净检出经真实 native:sync 初始化，重复同步及缺失骨架恢复不覆盖项目', { timeout: 30000 }, t => {
  const root = temporary(t), repository = new URL('../../', import.meta.url).pathname
  const app = path.join(root, 'app'), native = path.join(app, 'ios/App')
  fs.mkdirSync(native, { recursive: true })
  for (const relative of ['scripts/normalize-capacitor-spm.mjs', 'app/capacitor.config.ts',
    'app/ios/App/App.xcodeproj/project.pbxproj', 'app/ios/App/App/Info.plist'])
    write(root, relative, fs.readFileSync(path.join(repository, relative)))
  const pkg = JSON.parse(fs.readFileSync(path.join(repository, 'app/package.json')))
  // 只替代未受影响的前端编译；SPM 准备、锁定 CLI 的 sync 与兼容适配均走真实脚本。
  pkg.scripts.build = 'node prepare-assets.cjs'
  write(root, 'app/package.json', JSON.stringify(pkg))
  write(root, 'app/prepare-assets.cjs', "require('node:fs').mkdirSync('dist',{recursive:true});require('node:fs').writeFileSync('dist/index.html','<html>fixture</html>')")
  const dependencies = path.join(repository, 'app/node_modules'), modules = path.join(app, 'node_modules')
  fs.mkdirSync(modules)
  for (const entry of fs.readdirSync(dependencies)) {
    if (entry === '@capacitor-community') {
      fs.mkdirSync(path.join(modules, entry))
      // sync 会更新插件 Package.swift；复制插件，避免改动宿主依赖。
      fs.cpSync(path.join(dependencies, entry, 'sqlite'), path.join(modules, entry, 'sqlite'), { recursive: true })
    } else fs.symlinkSync(path.join(dependencies, entry), path.join(modules, entry))
  }
  const sentinel = write(root, 'app/ios/App/App/AppDelegate.swift', 'existing project source')
  const spm = path.join(native, 'CapApp-SPM'), target = path.join(spm, 'Sources/CapApp-SPM/CapApp-SPM.swift')
  assert.equal(fs.existsSync(spm), false)
  assert.equal(fs.existsSync(path.join(native, 'Podfile')), false)
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync('npm', ['--prefix', app, 'run', 'native:sync'], { cwd: root, encoding: 'utf8', timeout: 12000,
      env: { ...process.env, CI: 'true', PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH } })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.doesNotMatch(result.stdout + result.stderr, /pod install/)
    const manifest = fs.readFileSync(path.join(spm, 'Package.swift'), 'utf8')
    assert.match(manifest, /platforms: \[\.iOS\("27\.0"\)\]/)
    assert.match(manifest, /CapacitorCommunitySqlite/)
    assert.match(fs.readFileSync(target, 'utf8'), /isCapacitorApp = true/)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'existing project source')
  }
  const manifest = fs.readFileSync(path.join(spm, 'Package.swift'))
  fs.unlinkSync(target)
  const script = path.join(root, 'scripts/normalize-capacitor-spm.mjs')
  assert.equal(spawnSync(process.execPath, [script, '--prepare']).status, 0)
  assert.deepEqual(fs.readFileSync(path.join(spm, 'Package.swift')), manifest, '准备阶段不覆写现有清单')
  assert.match(fs.readFileSync(target, 'utf8'), /isCapacitorApp = true/)
  fs.unlinkSync(target)
  fs.symlinkSync(sentinel, target)
  assert.notEqual(spawnSync(process.execPath, [script, '--prepare']).status, 0, '拒绝向链接目标写入')
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'existing project source')
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

test('受管方案切换隔离真实 SQLite 数据集，跨数据集在卸载前拒绝，新包捕获新基线', async t => {
  const p = baselineFixture(t), session = { directory: p.session, context: p.context }
  const empty = fs.readFileSync(p.file), seenDatasets = new Set()
  let currentHash = p.appHash
  const capture = () => {
    const result = p.execute('capture', { appHash: currentHash })
    assert.equal(result.status, 0, result.stderr)
    const receipt = JSON.parse(fs.readFileSync(path.join(p.session, 'ui-baseline/receipt.json')))
    assert.ok(!seenDatasets.has(receipt.datasetId))
    seenDatasets.add(receipt.datasetId)
  }
  const inspect = () => inspectInstallation(session, p.container, currentHash, async (lease, mode) => {
    const checked = p.execute(mode, { appHash: lease.appHash })
    if (checked.status !== 0) throw new Error('拒绝跨数据集替换')
  }, true)
  capture()
  for (const nextHash of ['b'.repeat(64), p.appHash]) {
    assert.equal(p.fixture('debug-report-42').status, 0)
    const db = new DatabaseSync(p.file)
    const original = db.prepare('SELECT dataset_id AS id FROM ledger_meta').get().id
    db.prepare('UPDATE ledger_meta SET dataset_id=?').run(randomUUID())
    db.close()
    const before = hashPaths(p.container, ['.'])
    await assert.rejects(inspect(), /拒绝跨数据集/)
    assert.equal(hashPaths(p.container, ['.']), before, '拒绝时不更改账本')
    assert.ok(fs.existsSync(p.leaseFile))
    assert.ok(fs.existsSync(path.join(p.session, 'ui-baseline/receipt.json')))
    const repaired = new DatabaseSync(p.file)
    repaired.prepare('UPDATE ledger_meta SET dataset_id=?').run(original)
    repaired.close()
    await inspect()
    // 只模拟本临时工程的受管卸载和正式初始化；不把旧终态当作新包基线。
    fs.rmSync(path.dirname(p.file), { recursive: true })
    forgetInstallation(session)
    write(p.root, path.relative(p.root, p.file), empty)
    const fresh = new DatabaseSync(p.file)
    fresh.prepare('UPDATE ledger_meta SET dataset_id=?').run(randomUUID())
    assert.equal(fresh.prepare('SELECT count(*) AS n FROM ledger_entry').get().n, 0)
    assert.equal(fresh.prepare('SELECT count(*) AS n FROM ledger_draft').get().n, 0)
    fresh.close()
    currentHash = nextHash
    recordInstallation(session, p.container, currentHash)
    assert.equal(readInstallationLease(session).appHash, currentHash)
    capture()
  }
  assert.equal(seenDatasets.size, 3)
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
    { appHash: 'invalid' }, { container: 'relative' }, { container: '/foreign-container' },
    { container: p.container.replace(p.context.simulatorId, randomUUID()) },
    { container: p.container + '/child' }, { container: path.dirname(p.container) + '/not-a-uuid' }]) {
    fs.writeFileSync(p.leaseFile, JSON.stringify({ ...p.lease, ...patch }))
    assert.throws(() => readInstallationLease(session))
  }
  const moved = path.join(path.dirname(p.container), randomUUID())
  fs.writeFileSync(p.leaseFile, JSON.stringify({ ...p.lease, container: moved }))
  assert.equal(readInstallationLease(session).container, moved, '允许已搬走但仍属本设备的旧路径，交由基线校验迁移')
  fs.symlinkSync(p.container, moved)
  assert.throws(() => readInstallationLease(session), /路径含链接/)
  fs.unlinkSync(moved)
  fs.symlinkSync(path.join(p.container, 'missing'), moved)
  assert.throws(() => readInstallationLease(session), /路径含链接/, '悬空沙盒链接也拒绝')
  fs.unlinkSync(moved)
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

for (const phase of ['before-move', 'old-moved', 'new-moved', 'partial-cleanup']) {
  test(`UI 基线替换 ${phase} 被终止后同一会话可恢复，连续中断仍不丢原目录`, t => {
    const p = baselineFixture(t)
    assert.equal(p.execute('capture').status, 0)
    assert.equal(p.fixture('debug-report-42').status, 0)
    const kill = stage => spawnSync('python3', ['-I', '-c', `
import os, runpy, shutil, signal, sys
from pathlib import Path
module = runpy.run_path(sys.argv[1])
stage = sys.argv[2]
rename = Path.rename
remove = shutil.rmtree
def move(self, target):
    if stage == 'before-move' and self.name == 'OfflineLedger': os.kill(os.getpid(), signal.SIGTERM)
    value = rename(self, target)
    if (stage == 'old-moved' and self.name == 'OfflineLedger') or (stage == 'new-moved' and self.name.startswith('offline-reset-')):
        os.kill(os.getpid(), signal.SIGTERM)
    return value
def cleanup(folder, *args, **kwargs):
    if stage == 'partial-cleanup' and Path(folder).name.startswith('offline-previous-'):
        (Path(folder) / 'ledgerSQLite.db').unlink()
        os.kill(os.getpid(), signal.SIGTERM)
    return remove(folder, *args, **kwargs)
Path.rename = move
shutil.rmtree = cleanup
module['run']('restore', *sys.argv[3:])
`, p.script, stage, p.contextFile, p.container, p.appHash], { cwd: p.root, encoding: 'utf8' })
    assert.equal(kill(phase).signal, 'SIGTERM')
    const journal = path.join(p.session, 'ui-reset.json')
    assert.equal(fs.existsSync(journal), true)
    // 同一失败会话再次恢复途中被终止，不能靠重建模拟器或丢弃数据解围。
    assert.equal(kill('new-moved').signal, 'SIGTERM')
    const result = p.execute('restore')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(fs.readFileSync(p.file), fs.readFileSync(path.join(p.session, 'ui-baseline/ledgerSQLite.db')))
    assert.equal(fs.existsSync(journal), false)
    assert.deepEqual(fs.readdirSync(path.join(p.container, 'Library')), ['OfflineLedger'])
  })
}

test('UI 重置断点篡改/跨数据集拒绝恢复，不清除原目录和日志', t => {
  const p = baselineFixture(t)
  assert.equal(p.execute('capture').status, 0)
  const original = hashPaths(path.dirname(p.file), ['.'])
  const receipt = JSON.parse(fs.readFileSync(path.join(p.session, 'ui-baseline/receipt.json')))
  const journal = path.join(p.session, 'ui-reset.json')
  for (const patch of [{ datasetId: randomUUID() }, { container: '/other' }, { operation: '../outside' }]) {
    fs.writeFileSync(journal, JSON.stringify({ ...receipt, schema: 1, operation: randomUUID(), ...patch }), { mode: 0o600 })
    assert.notEqual(p.execute('restore').status, 0)
    assert.equal(hashPaths(path.dirname(p.file), ['.']), original)
    assert.equal(fs.existsSync(journal), true)
  }
})
