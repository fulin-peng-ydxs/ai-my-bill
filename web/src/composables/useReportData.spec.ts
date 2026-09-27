import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getExpenseReport, getIncomeReport, getReportSummary } from '../api/reports'
import { ApiClientError } from '../api/http'
import { useReportData } from './useReportData'

vi.mock('../api/reports', () => ({ getReportSummary: vi.fn(), getExpenseReport: vi.fn(), getIncomeReport: vi.fn(), getTimeReport: vi.fn() }))
const filters = { scope: 'EXPENSE' as const, range: 'THIS_MONTH' as const, query: '' }
const view = { dimension: 'PRODUCT' as const, grain: 'DAY' as const, metric: 'NET_EXPENSE' as const }
const summary = { totalIncome: '0.00', grossExpense: '37.00', adjustmentAmount: '0.00', netExpense: '37.00', balance: '-37.00', matchingItemCount: 2, dataPoints: [] }
const expense = { dimension: 'PRODUCT' as const, measureLabel: '原始支出', points: [], truncated: false }
afterEach(() => vi.resetAllMocks())

function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('atomic report snapshots', () => {
  it('retains the successful filter and blocks drilling while loading and after a partial failure', async () => {
    const scope = effectScope(), state = scope.run(useReportData)!
    vi.mocked(getReportSummary).mockResolvedValue(summary)
    vi.mocked(getExpenseReport).mockResolvedValue(expense)
    await state.load(filters, view)
    const delayed = pending<typeof summary>()
    vi.mocked(getReportSummary).mockReturnValueOnce(delayed.promise)
    vi.mocked(getExpenseReport).mockRejectedValueOnce(new TypeError('offline'))
    const refresh = state.load({ ...filters, query: 'absent' }, view)
    expect(state.canDrill.value).toBe(false)
    await refresh
    expect(state.status.value).toBe('error')
    expect(state.data.value?.filters.query).toBe('')
    expect(state.data.value?.summary.grossExpense).toBe('37.00')
    delayed.resolve({ ...summary, grossExpense: '999.00' })
    await Promise.resolve()
    expect(state.data.value?.summary.grossExpense).toBe('37.00')
    expect(state.canDrill.value).toBe(false)
    await state.load({ ...filters, query: 'recovered' }, view)
    expect(state.data.value?.filters.query).toBe('recovered')
    expect(state.canDrill.value).toBe(true)
    scope.stop()
  })

  it('removes stale private results when the server revokes access', async () => {
    const scope = effectScope(), state = scope.run(useReportData)!
    vi.mocked(getReportSummary).mockResolvedValue(summary)
    vi.mocked(getExpenseReport).mockResolvedValue(expense)
    await state.load(filters, view)
    vi.mocked(getReportSummary).mockRejectedValueOnce(new ApiClientError(403))
    await state.load(filters, view)
    expect(state.data.value).toBeUndefined()
    expect(state.canDrill.value).toBe(false)
    scope.stop()
  })

  it('drops the entire late snapshot when switching scope and dimension', async () => {
    const scope = effectScope(), state = scope.run(useReportData)!
    const old = pending<typeof summary>()
    vi.mocked(getReportSummary).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...summary, totalIncome: '50.00' })
    vi.mocked(getExpenseReport).mockResolvedValue(expense)
    vi.mocked(getIncomeReport).mockResolvedValue({ dimension: 'PAYER', measureLabel: '收入', points: [], truncated: false })
    const first = state.load(filters, view)
    await state.load({ ...filters, scope: 'INCOME' }, { ...view, dimension: 'PAYER', metric: 'TOTAL_INCOME' })
    old.resolve(summary); await first
    expect(state.data.value?.filters.scope).toBe('INCOME')
    expect(state.data.value?.income?.dimension).toBe('PAYER')
    expect(state.data.value?.expense).toBeUndefined()
    scope.stop()
  })

  it('preserves historical frequency points even with an empty current-period summary', async () => {
    const scope = effectScope(), state = scope.run(useReportData)!
    vi.mocked(getReportSummary).mockResolvedValue({ ...summary, matchingItemCount: 0 })
    vi.mocked(getExpenseReport).mockResolvedValue({ ...expense, dimension: 'FREQUENCY', points: [
      { group: '长期未购买', label: '咖啡', value: 'p', amount: '2.00', itemCount: 2, detail: '上次购买', entryId: 'entry' },
    ] })
    await state.load(filters, { ...view, dimension: 'FREQUENCY' })
    expect(state.status.value).toBe('ready')
    expect(state.data.value?.expense?.points).toHaveLength(1)
    expect(state.canDrill.value).toBe(true)
    scope.stop()
  })
})
