import { migrations } from '../src/data/migrations'
import { personalDraftScenario, personalPreferenceScenario, personalTemplateScenario, personalDatasetScenario, personalUpgradeScenario } from '../test-support/personalScenarios'
import { withProbeDatabases } from './probeDatabases'

/** 与 Node 共用 T7 场景，真实桥接执行草稿/偏好/模板和数据集隔离。 */
export async function personal() {
  return withProbeDatabases('t7', async (manager, prefix) => {
    const checks: string[] = []
    for (const [index, scenario] of [personalDraftScenario, personalPreferenceScenario, personalTemplateScenario, personalDatasetScenario].entries()) {
      const database = manager(`case${index}`)
      await database.open()
      checks.push(await scenario(database))
      await database.close()
    }
    checks.push(await personalUpgradeScenario(manager))
    return { checks, databasePrefix: prefix, schemaVersion: migrations.length }
  })
}
