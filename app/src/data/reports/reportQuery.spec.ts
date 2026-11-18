import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createSqliteBridge } from '../../../test-support/sqliteBridge'
const state = vi.hoisted(() => ({ fixture: undefined as ReturnType<typeof createSqliteBridge> | undefined }))
vi.mock('@capacitor/core', async () => {
  const { createSqliteBridge } = await import('../../../test-support/sqliteBridge')
  const fixture = createSqliteBridge(); state.fixture = fixture
  return { Capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true },
    registerPlugin: (name: string) => name === 'CapacitorSQLite' ? fixture.sqlite : fixture.files }
})
import { LedgerDatabase } from '../ledgerDatabase'
import { ReportQueryService } from './reportQueryService'
import type { ReportFilters, ReportTimeGrain } from '../../api/reports'
import { reportLegacyScenario, reportCalendarScenario, reportLifecycleScenario, reportUpgradeScenario, reportPrecisionScenario } from '../../../test-support/reportScenarios'
let db: LedgerDatabase, serial = 0
beforeEach(async () => { db = new LedgerDatabase(`report_${++serial}`); await db.open() })
afterEach(() => db.close())
afterAll(() => state.fixture!.dispose())
describe('T10 本地总览与时间', () => {
  it('冻结旧基线：总览、五种粒度、累计、同比环比和下钻', () => reportLegacyScenario(db))
  it('上海日历、闰日、边界裁剪、金额与历史覆盖及桶数保护', () => reportCalendarScenario(db))
  it('生命周期变更和同一队列读快照', () => reportLifecycleScenario(db))
  it('桥接精度和真实 SQLite 溢出', () => reportPrecisionScenario(db))
  it('v6 升级后报表兼容旧快照', () => reportUpgradeScenario((suffix, chain) => new LedgerDatabase(`report_upgrade_${serial}_${suffix}`, chain)))
})

it('非法范围/专属条件、日期、粒度及取消明确拒绝', async () => {
  const service = new ReportQueryService(db)
  const base: ReportFilters = { query: '', scope: 'ALL', range: 'TODAY' }
  for (const invalid of [{ scope: 'UNKNOWN' }, { productId: crypto.randomUUID() }, { scope: 'INCOME', productId: crypto.randomUUID() }, { scope: 'EXPENSE', payerId: crypto.randomUUID() }]) {
    await expect(service.snapshot({ ...base, ...invalid } as ReportFilters)).rejects.toMatchObject({ fieldErrors: [{ field: 'scope' }] })
  }
  await expect(service.snapshot({ ...base, query: '😀'.repeat(201) })).rejects.toMatchObject({ fieldErrors: [{ field: 'query' }] })
  await expect(service.snapshot({ ...base, range: 'CUSTOM', startDate: '2026-02-30', endDate: '2026-03-01' })).rejects.toMatchObject({ fieldErrors: [{ field: 'range' }] })
  await expect(service.snapshot(base, 'INVALID' as ReportTimeGrain)).rejects.toMatchObject({ fieldErrors: [{ field: 'grain' }] })
  const controller = new AbortController(); controller.abort()
  await expect(service.snapshot(base, 'DAY', controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
})
