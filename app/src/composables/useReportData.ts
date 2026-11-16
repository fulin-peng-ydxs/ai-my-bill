import { computed } from 'vue'

import { getExpenseReport, getIncomeReport, getReportSummary, getTimeReport,
  type ExpenseReport, type IncomeReport, type ReportFilters, type ReportSummary, type TimeReport } from '../api/reports'
import { isExpenseDimension, isIncomeDimension, type ReportPresentation } from '../domain/reportQuery'
import { useLatestRequest } from './useLatestRequest'

export interface ReportSnapshot {
  filters: ReportFilters
  presentation: ReportPresentation
  summary: ReportSummary
  time?: TimeReport
  expense?: ExpenseReport
  income?: IncomeReport
}

/** 摘要、维度和下钻上下文原子发布；任一请求失败仍保留同一个已成功快照。 */
export function useReportData() {
  const request = useLatestRequest<ReportSnapshot>()
  const canDrill = computed(() => request.status.value === 'ready' && !request.refreshing.value)
  async function load(filters: ReportFilters, presentation: ReportPresentation): Promise<void> {
    const snapshot = { ...filters }, view = { ...presentation }
    await request.execute(async (signal) => {
      const details: Pick<ReportSnapshot, 'time' | 'expense' | 'income'> = {}
      const summaryPromise = getReportSummary(snapshot, signal)
      const detailPromise = view.dimension === 'TIME'
        ? getTimeReport(snapshot, view.grain, signal).then(value => { details.time = value })
        : isExpenseDimension(view.dimension, snapshot.scope)
          ? getExpenseReport(snapshot, view.dimension, signal).then(value => { details.expense = value })
          : isIncomeDimension(view.dimension, snapshot.scope)
            ? getIncomeReport(snapshot, view.dimension, signal).then(value => { details.income = value })
            : Promise.resolve()
      const [summary] = await Promise.all([summaryPromise, detailPromise])
      return { filters: snapshot, presentation: view, summary, ...details }
    }, { intent: request.data.value ? 'refresh' : 'replace' })
  }
  return { ...request, canDrill, load }
}
