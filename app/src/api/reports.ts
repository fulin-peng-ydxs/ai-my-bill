import type { components } from './generated/schema'
import { apiRequest } from './http'

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

export function getReportSummary(filters: ReportFilters, signal?: AbortSignal): Promise<ReportSummary> {
  const params = reportParams(filters)
  return apiRequest(`/reports/summary?${params}`, { signal })
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

export function getTimeReport(filters: ReportFilters, grain: ReportTimeGrain, signal?: AbortSignal): Promise<TimeReport> {
  const params = reportParams(filters)
  params.set('grain', grain)
  return apiRequest(`/reports/time?${params}`, { signal })
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
