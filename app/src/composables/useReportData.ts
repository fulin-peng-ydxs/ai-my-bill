import { computed } from 'vue'

import { getCoreReport, getDimensionReport,
  type ExpenseReport, type IncomeReport, type ReportFilters, type ReportSummary, type TimeReport } from '../api/reports'
import { isExpenseDimension, isIncomeDimension, type ReportPresentation } from '../domain/reportQuery'
import { useLatestRequest } from './useLatestRequest'

export interface ReportSnapshot {
  filters: ReportFilters
  presentation: ReportPresentation
  /** 本地快照的实际范围，全部维度下钻均使用同一业务时钟。 */
  resolvedRange?: Pick<TimeReport, 'startDate' | 'endDate'>
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
      if (view.dimension === 'OVERVIEW' || view.dimension === 'TIME') {
        return { filters: snapshot, presentation: view, ...await getCoreReport(snapshot, view.dimension === 'TIME' ? view.grain : undefined, signal) }
      }
      if (!isExpenseDimension(view.dimension, snapshot.scope) && !isIncomeDimension(view.dimension, snapshot.scope))
        throw new Error('当前范围不支持该分析维度。')
      return { filters: snapshot, presentation: view, ...await getDimensionReport(snapshot, view.dimension, signal) }
    }, { intent: request.data.value ? 'refresh' : 'replace' })
  }
  return { ...request, canDrill, load }
}
