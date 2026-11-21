import type { components } from './generated/schema'
import { ReportQueryService } from '../data/reports/reportQueryService'
import { appDatabase } from '../data/appDatabase'
import { localOperation } from '../data/localOperation'
import { fieldError } from '../data/dictionaries/repository'
const reports = new ReportQueryService(appDatabase)

export type ReportScope = components['schemas']['ReportScope']
export type ReportSummary = components['schemas']['ReportSummary']
export type TimeReport = components['schemas']['TimeReport']
export type ReportTimeGrain = components['schemas']['ReportTimeGrain']
export type ReportTimeMetric = components['schemas']['ReportTimeMetric']
export type ExpenseReport = components['schemas']['ExpenseReport']
export type ExpenseReportDimension = components['schemas']['ExpenseReportDimension']
export type IncomeReport = components['schemas']['IncomeReport']
export type IncomeReportDimension = components['schemas']['IncomeReportDimension']

export interface ReportFilters {
  query: string
  scope: ReportScope
  range: components['schemas']['LedgerDateRange']
  startDate?: string
  endDate?: string
  fundingChannelId?: string
  primaryCategoryId?: string
  secondaryCategoryId?: string
  productId?: string
  purchaseChannelId?: string
  locationLabelId?: string
  incomeCategoryId?: string
  payerId?: string
  incomeName?: string
}

/** 总览/时间共享同一原生账本读取，避免摘要与趋势之间插入正式写入。 */
export function getCoreReport(filters: ReportFilters, grain?: ReportTimeGrain, signal?: AbortSignal) {
  return localOperation(() => reports.snapshot(filters, grain, signal))
}
export async function getReportSummary(filters: ReportFilters, signal?: AbortSignal): Promise<ReportSummary> {
  return (await getCoreReport(filters, undefined, signal)).summary
}

/** 多维分析与摘要一次读取；页面不再并行访问网络或分别解析相对日期。 */
export function getDimensionReport(filters: ReportFilters, dimension: ExpenseReportDimension | IncomeReportDimension, signal?: AbortSignal) {
  return localOperation(() => reports.snapshot(filters, undefined, signal, dimension))
}

export async function getTimeReport(filters: ReportFilters, grain: ReportTimeGrain, signal?: AbortSignal): Promise<TimeReport> {
  return (await getCoreReport(filters, grain, signal)).time!
}

export async function getExpenseReport(
  filters: ReportFilters,
  dimension: ExpenseReportDimension,
  signal?: AbortSignal,
): Promise<ExpenseReport> {
  const snapshot = await getDimensionReport(filters, dimension, signal)
  if (!snapshot.expense) throw fieldError('scope', '请选择支出范围。')
  return snapshot.expense
}

export async function getIncomeReport(
  filters: ReportFilters,
  dimension: IncomeReportDimension,
  signal?: AbortSignal,
): Promise<IncomeReport> {
  const snapshot = await getDimensionReport(filters, dimension, signal)
  if (!snapshot.income) throw fieldError('scope', '请选择收入范围。')
  return snapshot.income
}
