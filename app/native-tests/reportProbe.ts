import { migrations } from '../src/data/migrations'
import { withProbeDatabases } from './probeDatabases'
import { reportLegacyScenario, reportCalendarScenario, reportLifecycleScenario, reportPrecisionScenario, reportUpgradeScenario } from '../test-support/reportScenarios'

/** 同一组精确 SQL、日历和升级场景在 Node 与原生 SQLite 执行；不进入生产包。 */
export function reportQueries() {
  return withProbeDatabases('t10', async (manager, prefix) => {
    const checks: string[] = [], timings: number[] = []
    for (const [index, scenario] of [reportLegacyScenario, reportCalendarScenario, reportLifecycleScenario, reportPrecisionScenario].entries()) {
      const db = manager(`case${index}`)
      await db.open()
      const start = performance.now()
      checks.push(await scenario(db))
      timings.push(performance.now() - start)
      await db.close()
    }
    checks.push(await reportUpgradeScenario(manager))
    return { checks, timings, databasePrefix: prefix, schemaVersion: migrations.length }
  })
}
