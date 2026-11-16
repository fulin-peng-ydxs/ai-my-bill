import { LedgerDatabase, type LifecycleStage } from '../src/data/ledgerDatabase'
import { migrations, sha256 } from '../src/data/migrations'
import { nativeSqlite, openIosDatabase } from '../src/infrastructure/database/nativeConnection'
import { ledgerFiles } from '../src/platform/ledgerFiles'
import type { Seed } from '../src/data/seed/defaults'

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(task: () => Promise<unknown>, message: string) {
  let rejected = false
  try { await task() } catch { rejected = true }
  check(rejected, message)
}

/** 原生隔离库夹具；直接调用生产生命周期和原生文件能力，不用模拟 SQLite。 */
export async function lifecycle() {
  const started = performance.now()
  const prefix = `probe_${crypto.randomUUID().replaceAll('-', '')}`
  const names: string[] = []
  const managers: LedgerDatabase[] = []
  const seedA: Seed = { version: 1, items: [{ id: 'cash', kind: 'FUNDING_CHANNEL', name: '现金', key: 'cash', order: 10 }], preferences: { enabled: false, count: 0, empty: '' } }
  const seedB: Seed = { version: 2, items: [{ id: 'cash', kind: 'FUNDING_CHANNEL', name: '现金钱包', key: 'cash', order: 10 }, { id: 'new', kind: 'FUNDING_CHANNEL', name: '新增推荐项', key: 'new', order: 20 }], preferences: { enabled: true, new_field: true } }
  const schema2 = [...migrations[0].schema, { type: 'index', name: 'preference_value', tableName: 'preference', sql: 'CREATE INDEX preference_value ON preference(value)' }]
  const next = { version: 2, schema: schema2, sql: "CREATE INDEX preference_value ON preference(value); INSERT INTO preference(key,value) SELECT 'new_field','false' WHERE NOT EXISTS(SELECT 1 FROM preference WHERE key='new_field');" }
  const third = { version: 3, schema: [...schema2, { type: 'index', name: 'dictionary_parent', tableName: 'dictionary_item', sql: 'CREATE INDEX dictionary_parent ON dictionary_item(parent_id)' }], sql: "CREATE INDEX dictionary_parent ON dictionary_item(parent_id);" }
  const chain = [...migrations, next, third]
  function manager(suffix: string, version = migrations, seed = seedA, files = ledgerFiles) {
    const name = `${prefix}_${suffix}`
    if (!names.includes(name)) names.push(name)
    const db = new LedgerDatabase(name, version, seed, files)
    managers.push(db)
    return db
  }
  const evidence: string[] = []
  try {
    const old = manager('main')
    await old.open()
    const dataset = await old.read(async sql => (await sql.query('SELECT dataset_id FROM ledger_meta'))[0].dataset_id)
    await old.write(async sql => {
      await sql.run("UPDATE dictionary_item SET name='零钱',normalized_name='零钱',sort_order=99,status='INACTIVE',row_version=2 WHERE id='cash'")
      await sql.run("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES('custom','FUNDING_CHANNEL','自定义','自定义','ACTIVE')")
    })
    const digest = await sha256('same-input')
    const execute = () => old.executeOnce('test.save', 'same', digest, async sql => {
      await sql.run("INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date) VALUES('saved','EXPENSE',?,'cash','现金','2026-11-16T09:00:00+08:00','2026-11-16')", ['1500'])
      await sql.run("INSERT INTO preference VALUES('saved','123')")
      return { id: 'saved' }
    })
    const results = await Promise.all([execute(), execute(), execute()])
    check(results.every(r => r.id === 'saved'), '并发幂等结果不一致')
    await rejects(() => old.executeOnce('test.save', 'same', 'a'.repeat(64), async () => null), '同键异内容未拒绝')
    await rejects(() => old.write(async sql => {
      await sql.run("INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date) VALUES('rollback','EXPENSE',?,'cash','现金','2026-11-16T09:00:00+08:00','2026-11-16')", ['1'])
      await sql.run("INSERT INTO preference VALUES('rollback','true')")
      await sql.run("INSERT INTO dictionary_item(id,kind,name,normalized_name,status,parent_id) VALUES('bad','EXPENSE_CATEGORY','坏引用','bad','ACTIVE','missing')")
    }), '外键失败未拒绝')
    check(await old.read(async sql => (await sql.query("SELECT * FROM preference WHERE key='rollback'")).length) === 0, '失败留下部分写入')
    const cancelled = new AbortController()
    await rejects(() => old.write(async sql => {
      await sql.run("INSERT INTO preference VALUES('cancelled','true')")
      cancelled.abort()
    }, cancelled.signal), '提交前取消未拒绝')
    check(await old.read(async sql => (await sql.query("SELECT * FROM preference WHERE key='cancelled'")).length) === 0, '取消后残留写入')
    check(await old.write(sql => sql.run("UPDATE dictionary_item SET name='错误覆盖' WHERE id='cash' AND row_version=1")) === 0, '过期版本覆盖用户值')
    await old.close()
    evidence.push('atomic-write-idempotency-foreign-key')

    let lowSpaceReached = false
    const low = manager('main', chain, seedB, { protect: options => ledgerFiles.protect(options), snapshot: async () => { lowSpaceReached = true; throw new Error('controlled-low-space') } })
    await rejects(() => low.open(), '低空间未拒绝')
    check(lowSpaceReached, '未触发低空间文件失败边界')
    const failed = manager('main', [...migrations, { version: 2, schema: schema2, sql: "CREATE TABLE should_rollback(id TEXT); INSERT INTO missing_table VALUES(1);" }], seedB)
    await rejects(() => failed.open(), '迁移故障未拒绝')
    const reopen = manager('main')
    await reopen.open()
    check(await reopen.read(async sql => (await sql.query("SELECT name FROM sqlite_master WHERE name='should_rollback'")).length) === 0, '失败 DDL 未回滚')
    await reopen.close()
    const upgraded = manager('main', chain, seedB)
    const upgradeStarted = performance.now()
    await upgraded.open()
    const upgradeMs = Math.round(performance.now() - upgradeStarted)
    const state = await upgraded.read(async sql => ({
      meta: (await sql.query('SELECT * FROM ledger_meta'))[0], items: await sql.query('SELECT * FROM dictionary_item ORDER BY id'),
      preferences: await sql.query('SELECT * FROM preference ORDER BY key'), history: await sql.query('SELECT * FROM migration_history ORDER BY version'),
      schema: await sql.query("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"),
    }))
    check(state.meta.dataset_id === dataset && state.meta.seed_version === 1 && state.meta.schema_version === 3 && state.history.length === 3, '升级破坏元信息')
    check(state.items.length === 2 && state.items[0].name === '零钱' && state.items[0].sort_order === 99 && state.items[0].status === 'INACTIVE', '升级覆盖用户字典')
    check(state.preferences.some(p => p.key === 'enabled' && p.value === 'false') && state.preferences.some(p => p.key === 'count' && p.value === '0') && state.preferences.some(p => p.key === 'empty' && p.value === '""'), '合法 false/0/空值丢失')
    check((await upgraded.executeOnce<{ id: string }>('test.save', 'same', digest, async () => { throw new Error('不应重做') })).id === 'saved', '重开后幂等丢失')
    check(await upgraded.read(async sql => (await sql.query("SELECT CAST(amount_cents AS TEXT) AS cents FROM ledger_entry WHERE id='saved'"))[0].cents) === '1500', '升级破坏精确账目金额')
    check(await upgraded.read(async sql => (await sql.query("SELECT * FROM ledger_entry WHERE id='rollback'")).length) === 0, '失败留下部分账目')
    await upgraded.write(async sql => { await sql.run('DELETE FROM ledger_entry'); await sql.run('DELETE FROM dictionary_item') })
    await upgraded.close()
    const empty = manager('main', chain, seedB)
    await empty.open()
    check(await empty.read(async sql => (await sql.query('SELECT * FROM dictionary_item')).length) === 0, '空字典被补种')
    await empty.close()
    evidence.push('upgrade-rollback-reopen-preserve-seed-user-values')

    const fresh = manager('fresh', chain, seedB)
    await fresh.open()
    const schema = await fresh.read(sql => sql.query("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"))
    check(JSON.stringify(schema) === JSON.stringify(state.schema), '新装与升级结构不一致')
    check(await fresh.read(async sql => (await sql.query('SELECT name FROM dictionary_item ORDER BY id'))[0].name) === '现金钱包', '新库未使用新 seed')
    check(await fresh.read(async sql => (await sql.query("SELECT value FROM preference WHERE key='new_field'"))[0].value) === 'true', '新装未采用新版 seed 偏好')
    check(state.preferences.some(p => p.key === 'new_field' && p.value === 'false'), '存量迁移缺省值被 seed 覆盖')
    await fresh.close()
    const step = manager('step', [...migrations, next])
    await step.open()
    await step.close()
    const stepUpgraded = manager('step', chain, seedB)
    await stepUpgraded.open()
    check(JSON.stringify(await stepUpgraded.read(sql => sql.query("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"))) === JSON.stringify(schema), '逐版本升级与直接跨版本升级结构不一致')
    await stepUpgraded.close()
    await rejects(() => manager('main').open(), '旧版本打开新库未拒绝')
    await rejects(() => manager('main', [migrations[0], { version: 3, schema: schema2, sql: '' }]).open(), '版本断档未拒绝')
    await rejects(() => manager('main', [{ ...migrations[0], sql: migrations[0].sql + '\n-- changed' }, next, third]).open(), '摘要变更未拒绝')
    evidence.push('fresh-upgrade-equivalence-newer-gap-digest-rejection')

    const interruptedSeed: Seed = { ...seedA, items: [...seedA.items, seedA.items[0]] }
    await rejects(() => manager('init', migrations, interruptedSeed).open(), '初始化中断未拒绝')
    const init = manager('init')
    await init.open()
    check(await init.read(async sql => (await sql.query('SELECT * FROM dictionary_item')).length) === 1, '初始化重试有半成品')
    await init.write(sql => sql.run('DROP TABLE ledger_meta'))
    await init.close()
    await rejects(() => manager('init').open(), '元信息缺失被重建')
    evidence.push('initialization-atomic-retry-missing-meta-refusal')
    const corruptions = [
      'DROP INDEX dictionary_root_name; CREATE INDEX dictionary_root_name ON dictionary_item(kind,normalized_name);',
      'ALTER TABLE dictionary_item ADD COLUMN unexpected TEXT;',
      'DROP TABLE preference; CREATE TABLE preference(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;',
      "DROP TABLE ledger_entry; CREATE TABLE ledger_entry(id TEXT PRIMARY KEY,amount_cents REAL);",
    ]
    for (let i = 0; i < corruptions.length; i++) {
      const broken = manager(`broken${i}`)
      await broken.open()
      await broken.close()
      const raw = await openIosDatabase(broken.name, 1)
      try { await raw.execute(corruptions[i]) } finally { await nativeSqlite.closeConnection(broken.name, false) }
      let code: unknown
      try { await broken.open() } catch (error) { code = (error as { code?: unknown }).code }
      check(code === 'DATABASE_INCOMPATIBLE', '结构漂移未以明确的不兼容错误拒绝')
    }
    return { checks: evidence, databasePrefix: prefix, upgradeMs, upgradedDictionaryRows: state.items.length, durationMs: Math.round(performance.now() - started) }
  } catch (error) {
    const cause = (error as Error).cause
    if (cause) throw new Error(JSON.stringify(cause), { cause: error })
    throw error
  } finally {
    for (const manager of managers) await manager.close()
    for (const name of names) {
      const db = await nativeSqlite.createConnection(name, false, 'no-encryption', 1, false)
      try { await db.delete() } finally { await nativeSqlite.closeConnection(name, false) }
    }
  }
}

// 三个中断点均消费正式 open→upgrade 流程，观察器只存在于 test bundle 的调用方。
const crashMigration = { version: 2, sql: 'CREATE TABLE interrupted_migration(id TEXT PRIMARY KEY) STRICT;',
  schema: [...migrations[0].schema, { type: 'table', name: 'interrupted_migration', tableName: 'interrupted_migration', sql: 'CREATE TABLE interrupted_migration(id TEXT PRIMARY KEY) STRICT' }] }
const crashChain = [...migrations, crashMigration]
const crashStages: readonly LifecycleStage[] = ['snapshot-ready', 'migration-recorded', 'upgrade-committed']
function crashName(stage: LifecycleStage) { return `probe_crash_${stage.replaceAll('-', '_')}` }

export async function prepareCrash(stage: LifecycleStage) {
  check(crashStages.includes(stage), '未知中断阶段')
  const name = crashName(stage)
  const old = new LedgerDatabase(name)
  await old.open()
  await old.write(sql => sql.run("INSERT INTO preference VALUES('crash_baseline','12345')"))
  await old.close()
  let reached!: () => void
  let failed!: (error: unknown) => void
  const signal = new Promise<void>((resolve, reject) => { reached = resolve; failed = reject })
  const upgrading = new LedgerDatabase(name, crashChain, undefined, undefined, async (current, version) => {
    if (current === stage && (current === 'snapshot-ready' || version === 2)) {
      reached()
      await new Promise<void>(() => {})
    }
  })
  void upgrading.open().then(() => failed(new Error('未停在指定升级阶段')), failed)
  await signal
  return { stage, database: name }
}

export async function recoverCrash(stage: LifecycleStage) {
  check(crashStages.includes(stage), '未知恢复阶段')
  const name = crashName(stage)
  // 提交前须仍可由旧版本正常打开；提交后必须直接读到新版本且不重复执行迁移。
  const db = new LedgerDatabase(name, stage === 'upgrade-committed' ? crashChain : migrations)
  try {
    await db.open()
    await db.read(async sql => {
      check((await sql.query("SELECT value FROM preference WHERE key='crash_baseline'"))[0]?.value === '12345', '已提交基线丢失')
      const committed = stage === 'upgrade-committed'
      check((await sql.query("SELECT name FROM sqlite_master WHERE name='interrupted_migration'")).length === Number(committed), '中断后的结构状态错误')
      check((await sql.query('SELECT * FROM migration_history')).length === (committed ? 2 : 1), '中断后的迁移履历错误')
      check((await sql.query('SELECT schema_version FROM ledger_meta'))[0].schema_version === (committed ? 2 : 1), '中断后的版本错误')
    })
    await db.close()
    const retry = new LedgerDatabase(name, crashChain)
    try {
      await retry.open()
      check(await retry.read(async sql => (await sql.query('SELECT * FROM migration_history')).length) === 2, '重试未完成升级或重复履历')
    } finally { await retry.close() }
  } finally {
    await db.close()
    const raw = await nativeSqlite.createConnection(name, false, 'no-encryption', 1, false)
    try { await raw.delete() } finally { await nativeSqlite.closeConnection(name, false) }
  }
  return { stage, database: name }
}
