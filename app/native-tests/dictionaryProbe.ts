import { LedgerDatabase } from '../src/data/ledgerDatabase'
import { nativeSqlite } from '../src/infrastructure/database/nativeConnection'
import { migrations, type Migration } from '../src/data/migrations'
import type { Seed } from '../src/data/seed/defaults'
import {
  dictionaryTypes, dictionaryCrudScenario, dictionaryValidationScenario, dictionarySortScenario,
  dictionaryReferencesScenario, dictionaryMergeScenario, dictionaryTemplateScenario,
} from '../test-support/dictionaryScenarios'
import { dictionaryUpgradeScenario } from '../test-support/dictionaryUpgradeScenario'

/** 测试包通过正式服务/生产账本生命周期在原生 SQLite 执行，与 Node SQL 场景共享断言。 */
export async function dictionaries() {
  const started = performance.now()
  const prefix = `probe_t5_${crypto.randomUUID().replaceAll('-', '')}`
  const names = new Set<string>()
  const managers: LedgerDatabase[] = []
  function manager(suffix: string, chain: readonly Migration[] = migrations, seed?: Seed) {
    const name = `${prefix}_${suffix}`
    names.add(name)
    const database = new LedgerDatabase(name, chain, seed)
    managers.push(database)
    return database
  }
  const checks: string[] = []
  try {
    const crud = manager('crud')
    await crud.open()
    for (const type of dictionaryTypes) {
      await dictionaryCrudScenario(crud, type)
    }
    await crud.close()
    checks.push('eight-dictionary-crud-candidates-and-history')
    const scenarios = [dictionaryValidationScenario, dictionarySortScenario, dictionaryReferencesScenario, dictionaryMergeScenario]
    for (let index = 0; index < scenarios.length; index += 1) {
      const database = manager(`case${index}`)
      await database.open()
      checks.push(await scenarios[index](database))
      await database.close()
    }
    checks.push(await dictionaryUpgradeScenario(manager))
    for (const variant of ['source-only', 'target-newer', 'rename-conflict'] as const) {
      const database = manager(variant.replaceAll('-', '_'))
      await database.open()
      checks.push(await dictionaryTemplateScenario(database, variant))
      await database.close()
    }
    return { checks, databasePrefix: prefix, schemaVersion: migrations.length, durationMs: Math.round(performance.now() - started) }
  } finally {
    for (const database of managers) {
      await database.close()
    }
    for (const name of names) {
      const database = await nativeSqlite.createConnection(name, false, 'no-encryption', 1, false)
      try {
        await database.delete()
      } finally {
        await nativeSqlite.closeConnection(name, false)
      }
    }
  }
}
