import { afterAll, afterEach, beforeEach, describe, it, vi } from 'vitest'
import type { createSqliteBridge } from '../../../test-support/sqliteBridge'
const state = vi.hoisted(() => ({ fixture: undefined as ReturnType<typeof createSqliteBridge> | undefined }))
vi.mock('@capacitor/core', async () => {
  const { createSqliteBridge } = await import('../../../test-support/sqliteBridge')
  const fixture = createSqliteBridge()
  state.fixture = fixture
  return { Capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true },
    registerPlugin: (name: string) => name === 'CapacitorSQLite' ? fixture.sqlite : fixture.files }
})
import { LedgerDatabase } from '../ledgerDatabase'
import { personalDraftScenario, personalPreferenceScenario, personalTemplateScenario, personalDatasetScenario, personalUpgradeScenario } from '../../../test-support/personalScenarios'
let database: LedgerDatabase
let counter = 0
beforeEach(async () => {
  database = new LedgerDatabase(`personal_${++counter}`)
  await database.open()
})
afterEach(() => database.close())
afterAll(() => state.fixture!.dispose())
describe('T7 本地个人状态', () => {
  it('两类草稿重开、非法旧值、过期与写入失败重试', () => personalDraftScenario(database))
  it('偏好持久化、消费、重置与失效资金渠道回退', () => personalPreferenceScenario(database))
  it('模板唯一键、白名单、改名合并、失效回退及来源删除', () => personalTemplateScenario(database))
  it('排队中的旧数据集写入不能污染恢复后的库', () => personalDatasetScenario(database))
  it('v4→v5 仅补缺失配置，保护用户值和 false/0/空值', () => personalUpgradeScenario((suffix, chain) => new LedgerDatabase(`personal_${counter}_${suffix}`, chain)))
})
