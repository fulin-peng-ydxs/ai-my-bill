import { LedgerDatabase } from '../src/data/ledgerDatabase'
import { migrations } from '../src/data/migrations'
import { nativeSqlite } from '../src/infrastructure/database/nativeConnection'
import { entryWriteScenario, entryValidationScenario, entryFailureUndoScenario, legacyEntryFixture } from '../test-support/entryScenarios'

/** 与 Node 共用业务场景，在真实 WKWebView → Capacitor → SQLite 桥执行。 */
export async function entries() {
  const started = performance.now()
  const prefix = `probe_t6_${crypto.randomUUID().replaceAll('-', '')}`
  const names: string[] = []
  const managers: LedgerDatabase[] = []
  const checks: string[] = []
  const observations: { saveMs: number; reopenReadMs: number }[] = []
  function manager(suffix: string, legacy = false) {
    const name = `${prefix}_${suffix}`
    names.push(name)
    const database = new LedgerDatabase(name, legacy ? migrations.slice(0, 2) : migrations)
    managers.push(database)
    return database
  }
  try {
    for (const [index, scenario] of [entryWriteScenario, entryValidationScenario, entryFailureUndoScenario].entries()) {
      const database = manager(`case${index}`)
      await database.open()
      checks.push(await scenario(database, timing => observations.push(timing)))
      await database.close()
    }
    const legacy = manager('upgrade', true)
    await legacy.open()
    const before = (await legacy.read(sql => sql.query('SELECT * FROM ledger_meta')))[0]!
    await legacyEntryFixture(legacy)
    await legacy.close()
    const upgraded = manager('upgrade')
    await upgraded.open()
    const after = (await upgraded.read(sql => sql.query('SELECT * FROM ledger_meta')))[0]!
    const theme = (await upgraded.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0]!
    const entry = (await upgraded.read(sql => sql.query("SELECT CAST(amount_cents AS TEXT) AS cents,quantity_scaled FROM ledger_entry WHERE id='legacy-entry'")))[0]!
    if (after.dataset_id !== before.dataset_id || after.schema_version !== migrations.length || theme.value !== '"DARK"' || entry.cents !== '1500' || entry.quantity_scaled != null) {
      throw new Error('v2→v3 升级覆盖用户数据')
    }
    checks.push('v2-v3-native-upgrade-preserves-dataset-and-preferences')
    return { checks, observations, databasePrefix: prefix, schemaVersion: migrations.length, durationMs: Math.round(performance.now() - started) }
  } finally {
    for (const database of managers) {
      await database.close()
    }
    for (const name of new Set(names)) {
      const cleanup = await nativeSqlite.createConnection(name, false, 'no-encryption', 1, false)
      try {
        await cleanup.delete()
      } finally {
        await nativeSqlite.closeConnection(name, false)
      }
    }
  }
}
