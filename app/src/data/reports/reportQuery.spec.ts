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
import { entryFixture } from '../../../test-support/entryScenarios'
import { EntryReadbackQuery } from '../entries/readbackQuery'
import { AdjustmentService } from '../entries/adjustmentService'
import touchFixture from '../../../test-support/reportTouchFixture.json'
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

it.each([
  ['TODAY', '2026-11-22T15:59:59Z', '2026-11-22'],
  ['THIS_WEEK', '2026-11-22T15:59:59Z', '2026-11-16'],
  ['THIS_MONTH', '2026-11-30T15:59:59Z', '2026-11-01'],
  ['THIS_YEAR', '2026-12-31T15:59:59Z', '2026-01-01'],
] as const)('总览 %s 在请求中跨午夜仍返回实际查询边界，明细组成原合计', async (range, before, startDate) => {
  const after = new Date(Date.parse(before) + 2000)
  const f = await entryFixture(db, after)
  await f.service.createIncome({ ...f.income, amount: '1.00', occurredAt: before }, 'before-midnight')
  await f.service.createIncome({ ...f.income, amount: '2.00', occurredAt: after.toISOString() }, 'after-midnight')
  let now = new Date(before)
  const clock = vi.fn(() => now)
  const pending = new ReportQueryService(db, clock).snapshot({ query: '', scope: 'ALL', range })
  now = after
  const snapshot = await pending
  const endDate = before.slice(0, 10)
  expect(clock).toHaveBeenCalledTimes(1)
  expect(snapshot).toMatchObject({ resolvedRange: { startDate, endDate }, summary: { totalIncome: '1.00' } })
  const page = await new EntryReadbackQuery(db, () => after).list({ query: '', type: 'INCOME', lifecycle: 'ACTIVE', range: 'CUSTOM', startDate, endDate })
  expect(page.items).toHaveLength(1)
  expect(page.items[0].amount).toBe(snapshot.summary.totalIncome)
})

it.each(['2026-11-18T15:59:59Z', '2026-11-30T15:59:59Z', '2026-12-31T15:59:59Z'])(
  '粒度验收跨午夜执行 %s：固定夹具范围和五种时段不随执行日期漂移', async before => {
    const after = new Date(Date.parse(before) + 2000)
    const f = await entryFixture(db, new Date(before))
    const source = await f.service.createExpense({ ...f.expense, occurredAt: touchFixture.occurredAt }, 'touch-expense')
    await f.service.createIncome({ ...f.income, occurredAt: touchFixture.occurredAt }, 'touch-income')
    const dataset = String((await db.read(sql => sql.query('SELECT dataset_id FROM ledger_meta')))[0]!.dataset_id)
    await new AdjustmentService(db, () => new Date(before)).create(dataset, source.id,
      { adjustmentType: 'REFUND', amount: '3.00', occurredAt: touchFixture.occurredAt }, 'touch-refund')
    const filters: ReportFilters = { query: '', scope: 'ALL', range: 'CUSTOM',
      startDate: touchFixture.startDate, endDate: touchFixture.endDate }
    for (const [grain, label] of [['DAY', '按日'], ['WEEK', '按周'], ['MONTH', '按月'], ['QUARTER', '按季'], ['YEAR', '按年']] as const) {
      const report = await new ReportQueryService(db, () => after).snapshot(filters, grain)
      const period = report.time!.buckets.filter(bucket => bucket.itemCount > 0).at(-1)!
      expect(report.resolvedRange).toEqual({ startDate: touchFixture.startDate, endDate: touchFixture.endDate })
      expect(period.label).toBe(touchFixture.periods[label])
      expect([report.summary.balance, period.balance, period.cumulativeBalance]).toEqual(['988.00', '988.00', '988.00'])
    }
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
