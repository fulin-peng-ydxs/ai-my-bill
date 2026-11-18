import { migrations } from '../src/data/migrations'
import { withProbeDatabases } from './probeDatabases'
import { adjustmentLifecycleScenario, lifecycleFailureScenario, cleanupScenario, cleanupProtectionScenario, lifecycleUpgradeScenario } from '../test-support/lifecycleScenarios'

/** Node/原生共用 T8 场景；随机库、时钟和失败点不进入正式 App。 */
export function adjustments() {
  return withProbeDatabases('t8', async (manager, prefix) => {
    const checks: string[] = []
    for (const [index, scenario] of [adjustmentLifecycleScenario, lifecycleFailureScenario, cleanupScenario, cleanupProtectionScenario].entries()) {
      const db = manager(`case${index}`); await db.open()
      checks.push(await scenario(db)); await db.close()
    }
    checks.push(await lifecycleUpgradeScenario(manager))
    return { checks, databasePrefix: prefix, schemaVersion: migrations.length }
  })
}
