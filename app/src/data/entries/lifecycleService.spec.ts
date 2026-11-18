import { afterAll, afterEach, beforeEach, describe, it, vi } from 'vitest'
import type { createSqliteBridge } from '../../../test-support/sqliteBridge'
const state = vi.hoisted(() => ({ fixture: undefined as ReturnType<typeof createSqliteBridge> | undefined }))
vi.mock('@capacitor/core', async () => {
  const { createSqliteBridge } = await import('../../../test-support/sqliteBridge')
  const fixture = createSqliteBridge(); state.fixture = fixture
  return { Capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true },
    registerPlugin: (name: string) => name === 'CapacitorSQLite' ? fixture.sqlite : fixture.files }
})
import { LedgerDatabase } from '../ledgerDatabase'
import { adjustmentLifecycleScenario, lifecycleFailureScenario, cleanupScenario, lifecycleUpgradeScenario, cleanupProtectionScenario } from '../../../test-support/lifecycleScenarios'
let db: LedgerDatabase
let counter = 0
beforeEach(async () => { db = new LedgerDatabase(`lifecycle_${++counter}`); await db.open() })
afterEach(() => db.close())
afterAll(() => state.fixture!.dispose())
describe('T8 调整与生命周期', () => {
  it('精确累计、幂等重试、冻结恢复及明确关联删除', () => adjustmentLifecycleScenario(db))
  it('并发上限、回执故障回滚、旧版本及恢复边界', () => lifecycleFailureScenario(db))
  it('时钟保护、百行批次、取消及重启恢复', () => cleanupScenario(db))
  it('关联总行数预算、批次故障回滚、五批上限和数据集隔离', () => cleanupProtectionScenario(db))
  it('v5→v6 原子升级及用户偏好/草稿保护', () => lifecycleUpgradeScenario((suffix, chain) => new LedgerDatabase(`upgrade_${counter}_${suffix}`, chain)))
})
