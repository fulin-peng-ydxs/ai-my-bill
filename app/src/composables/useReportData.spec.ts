import { effectScope } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { getCoreReport, getDimensionReport, getReportSummary, getExpenseReport, getIncomeReport } from '../api/reports'
import type { CoreReport } from '../data/reports/reportQueryService'
import { useReportData } from './useReportData'
import { LocalError } from '../domain/localError'
vi.mock('../api/reports', () => ({ getCoreReport: vi.fn(), getDimensionReport: vi.fn(), getReportSummary: vi.fn(), getExpenseReport: vi.fn(), getIncomeReport: vi.fn() }))
const filters = { query: '', scope: 'ALL' as const, range: 'THIS_MONTH' as const }
const view = { dimension: 'TIME' as const, grain: 'DAY' as const, metric: 'BALANCE' as const }
const core: CoreReport = { resolvedRange: { startDate: '2026-11-01', endDate: '2026-11-17' }, summary: { totalIncome: '1000.00', grossExpense: '15.00', adjustmentAmount: '3.00', netExpense: '12.00', balance: '988.00', matchingItemCount: 3, dataPoints: [] },
  time: { grain: 'DAY', startDate: '2026-11-01', endDate: '2026-11-17', buckets: [], comparisons: [] } }
afterEach(() => vi.resetAllMocks())
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
it('总览/时间只调用一次一致快照；失败保留原条件并禁止下钻，重试后恢复', async () => {
  const scope = effectScope(), report = scope.run(useReportData)!
  vi.mocked(getCoreReport).mockResolvedValue(core)
  await report.load(filters, view)
  expect(report.data.value?.time?.grain).toBe('DAY')
  expect(getCoreReport).toHaveBeenCalledTimes(1)
  for (const separate of [getReportSummary, getExpenseReport, getIncomeReport]) expect(separate).not.toHaveBeenCalled()
  vi.mocked(getCoreReport).mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '暂不可用', { retryable: true }))
  await report.load({ ...filters, query: 'new' }, view)
  expect(report.data.value?.filters.query).toBe('')
  expect(report.data.value?.resolvedRange).toEqual(core.resolvedRange)
  expect(report.error.value?.message).toBe('暂不可用')
  expect(report.canDrill.value).toBe(false)
  await report.load({ ...filters, query: 'new' }, view)
  expect(report.data.value?.filters.query).toBe('new')
  expect(report.canDrill.value).toBe(true)
  await report.load(filters, { ...view, dimension: 'OVERVIEW' })
  expect(vi.mocked(getCoreReport).mock.calls.at(-1)?.[1]).toBeUndefined()
  scope.stop()
})
it('条件和粒度替换时丢弃晚快照，调用方的后续修改不改写已捕获条件', async () => {
  const scope = effectScope(), report = scope.run(useReportData)!, old = deferred<CoreReport>()
  vi.mocked(getCoreReport).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...core, time: { ...core.time!, grain: 'MONTH' } })
  const firstFilters = { ...filters, query: 'old' }, pending = report.load(firstFilters, view)
  firstFilters.query = 'mutated'
  await report.load({ ...filters, query: 'new' }, { ...view, grain: 'MONTH' })
  old.resolve({ ...core, resolvedRange: { startDate: '2026-10-01', endDate: '2026-10-31' } }); await pending
  expect(report.data.value?.filters.query).toBe('new')
  expect(report.data.value?.time?.grain).toBe('MONTH')
  expect(report.data.value?.resolvedRange).toEqual(core.resolvedRange)
  expect(vi.mocked(getCoreReport).mock.calls[0][0].query).toBe('old')
  scope.stop()
})
it('释放页面取消当前原生查询；迟到结果不能发布', async () => {
  const scope = effectScope(), report = scope.run(useReportData)!, delayed = deferred<CoreReport>()
  vi.mocked(getCoreReport).mockReturnValue(delayed.promise)
  const pending = report.load(filters, view)
  const signal = vi.mocked(getCoreReport).mock.calls[0][2]!
  scope.stop()
  expect(signal.aborted).toBe(true)
  delayed.resolve(core); await pending
  expect(report.data.value).toBeUndefined()
})

it.each(['EXPENSE', 'INCOME'] as const)('%s 多维只消费一次完整快照，慢响应和失败不能混用摘要或旧下钻', async type => {
  const scope = effectScope(), report = scope.run(useReportData)!, old = deferred<CoreReport>()
  const detail = type === 'EXPENSE' ? { expense: { dimension: 'CATEGORY' as const, measureLabel: '原始支出（元）', points: [], truncated: false } }
    : { income: { dimension: 'CATEGORY' as const, measureLabel: '收入金额（元）', points: [], truncated: false } }
  vi.mocked(getDimensionReport).mockResolvedValue({ ...core, ...detail })
  await report.load({ ...filters, scope: type }, { ...view, dimension: 'CATEGORY' })
  expect(getDimensionReport).toHaveBeenCalledTimes(1)
  expect(getCoreReport).not.toHaveBeenCalled()
  expect(getReportSummary).not.toHaveBeenCalled()
  vi.mocked(getDimensionReport).mockReturnValueOnce(old.promise)
  const pending = report.load({ ...filters, scope: type, query: 'old' }, { ...view, dimension: 'CATEGORY' })
  expect(report.canDrill.value).toBe(false)
  await report.load({ ...filters, scope: type, query: 'new' }, { ...view, dimension: 'CATEGORY' })
  old.resolve({ ...core, resolvedRange: { startDate: '2020-01-01', endDate: '2020-01-01' } })
  await pending
  expect(report.data.value?.filters.query).toBe('new')
  expect(report.data.value?.resolvedRange).toEqual(core.resolvedRange)
  vi.mocked(getDimensionReport).mockRejectedValueOnce(new LocalError('DATABASE_BUSY', '稍后重试', { retryable: true }))
  await report.load({ ...filters, scope: type, query: 'failure' }, { ...view, dimension: 'CATEGORY' })
  expect(report.data.value?.filters.query).toBe('new')
  expect(report.canDrill.value).toBe(false)
  expect(report.error.value?.message).toBe('稍后重试')
  scope.stop()
})
