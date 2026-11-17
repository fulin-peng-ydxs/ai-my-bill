import { migrations } from '../src/data/migrations'
import { withProbeDatabases } from './probeDatabases'
import { entryWriteScenario, entryValidationScenario, entryFailureUndoScenario, legacyEntryFixture,
  entryReplayScenario, entrySearchScenario, entrySearchUpgradeScenario } from '../test-support/entryScenarios'

/** 与 Node 共用业务场景，在真实 WKWebView → Capacitor → SQLite 桥执行。 */
export async function entries() {
  const started = performance.now()
  return withProbeDatabases('t6', async (manager, prefix) => {
    const checks: string[] = []
    const observations: { saveMs: number; reopenReadMs: number }[] = []
    for (const [index, scenario] of [entryWriteScenario, entryValidationScenario, entryFailureUndoScenario, entryReplayScenario, entrySearchScenario].entries()) {
      const database = manager(`case${index}`)
      await database.open()
      checks.push(await scenario(database, timing => observations.push(timing)))
      await database.close()
    }
    const legacy = manager('upgrade', migrations.slice(0, 2))
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
      throw new Error('旧版升级覆盖用户数据')
    }
    checks.push('v2-current-native-upgrade-preserves-dataset-and-preferences')
    checks.push(await entrySearchUpgradeScenario(manager))
    return { checks, observations, databasePrefix: prefix, schemaVersion: migrations.length, durationMs: Math.round(performance.now() - started) }
  })
}
