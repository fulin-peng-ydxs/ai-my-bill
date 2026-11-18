import type { components } from './generated/schema'
import { apiRequest } from './http'
import { ReportQueryService } from '../data/reports/reportQueryService'
import { appDatabase } from '../data/appDatabase'
import { localOperation } from '../data/localOperation'
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

const OPTIONAL_KEYS = [
  'fundingChannelId', 'primaryCategoryId', 'secondaryCategoryId', 'productId',
  'purchaseChannelId', 'locationLabelId', 'incomeCategoryId', 'payerId', 'incomeName',
] as const

/** 总览/时间共享同一原生账本读取，避免摘要与趋势之间插入正式写入。 */
export function getCoreReport(filters: ReportFilters, grain?: ReportTimeGrain, signal?: AbortSignal) {
  return localOperation(() => reports.snapshot(filters, grain, signal))
}
export async function getReportSummary(filters: ReportFilters, signal?: AbortSignal): Promise<ReportSummary> {
  return (await getCoreReport(filters, undefined, signal)).summary
}

function reportParams(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams({ query: filters.query, scope: filters.scope, range: filters.range })
  for (const key of OPTIONAL_KEYS) if (filters[key]) params.set(key, filters[key])
  if (filters.range === 'CUSTOM' && filters.startDate && filters.endDate) {
    params.set('startDate', filters.startDate)
    params.set('endDate', filters.endDate)
  }
  return params
}

export async function getTimeReport(filters: ReportFilters, grain: ReportTimeGrain, signal?: AbortSignal): Promise<TimeReport> {
  return (await getCoreReport(filters, grain, signal)).time!
}

export function getExpenseReport(
  filters: ReportFilters,
  dimension: ExpenseReportDimension,
  signal?: AbortSignal,
): Promise<ExpenseReport> {
  const params = reportParams(filters)
  params.set('dimension', dimension)
  return apiRequest(`/reports/expenses?${params}`, { signal })
}

export function getIncomeReport(
  filters: ReportFilters,
  dimension: IncomeReportDimension,
  signal?: AbortSignal,
): Promise<IncomeReport> {
  const params = reportParams(filters)
  params.set('dimension', dimension)
  return apiRequest(`/reports/incomes?${params}`, { signal })
}
