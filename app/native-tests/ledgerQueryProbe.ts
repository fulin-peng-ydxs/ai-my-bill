import { migrations } from '../src/data/migrations'
import { withProbeDatabases } from './probeDatabases'
import { ledgerFilterScenario, ledgerPagingScenario, ledgerQueryUpgradeScenario } from '../test-support/ledgerQueryScenarios'

/** Node/原生共用 T9 查询与升级场景，随机数据库仅存于本轮测试沙盒。 */
export function ledgerQueries() {
  return withProbeDatabases('t9', async (manager, prefix) => {
    const checks: string[] = []
    for (const [index, scenario] of [ledgerFilterScenario, ledgerPagingScenario].entries()) {
      const db = manager(`case${index}`)
      await db.open()
      checks.push(await scenario(db))
      await db.close()
    }
    checks.push(await ledgerQueryUpgradeScenario(manager))
    return { checks, databasePrefix: prefix, schemaVersion: migrations.length }
  })
}
