import type { LocationQuery, LocationQueryRaw } from 'vue-router'

import type { LedgerDateRange } from '../api/ledgerEntries'
import type { ExpenseReportDimension, IncomeReportDimension, ReportFilters, ReportScope,
  ReportTimeGrain, ReportTimeMetric } from '../api/reports'

export type ReportDimension = 'OVERVIEW' | 'TIME' | ExpenseReportDimension | IncomeReportDimension
export interface ReportPresentation { dimension: ReportDimension, grain: ReportTimeGrain, metric: ReportTimeMetric }

const SCOPES: readonly ReportScope[] = ['ALL', 'EXPENSE', 'INCOME']
const RANGES: readonly LedgerDateRange[] = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'CUSTOM']
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const EXPENSE_DIMENSIONS: readonly ExpenseReportDimension[] = [
  'CATEGORY', 'PRODUCT', 'FUNDING_CHANNEL', 'PURCHASE_CHANNEL', 'LOCATION', 'HABIT', 'PRICE', 'FREQUENCY', 'QUALITY',
]
const INCOME_DIMENSIONS: readonly IncomeReportDimension[] = ['CATEGORY', 'FUNDING_CHANNEL', 'PAYER', 'NAME', 'FREQUENCY']
const UUID_KEYS = [
  'fundingChannelId', 'primaryCategoryId', 'secondaryCategoryId', 'productId',
  'purchaseChannelId', 'locationLabelId', 'incomeCategoryId', 'payerId',
] as const

function one(value: LocationQuery[string]): string {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value)
}

export function parseReportRoute(query: LocationQuery, defaultRange: LedgerDateRange): ReportFilters {
  const rawScope = one(query.scope)
  const scope = SCOPES.includes(rawScope as ReportScope) ? rawScope as ReportScope : 'ALL'
  const rawRange = one(query.range)
  let range = RANGES.includes(rawRange as LedgerDateRange) ? rawRange as LedgerDateRange : defaultRange
  const startDate = one(query.startDate)
  const endDate = one(query.endDate)
  const validCustom = validDate(startDate) && validDate(endDate) && startDate <= endDate
  if (range === 'CUSTOM' && !validCustom) range = defaultRange
  const rawQuery = one(query.q)
  const result: ReportFilters = {
    query: rawQuery.length <= 200 ? rawQuery : '', scope, range,
    ...(range === 'CUSTOM' && validCustom ? { startDate, endDate } : {}),
  }
  for (const key of UUID_KEYS) {
    const value = one(query[key])
    if (UUID.test(value)) result[key] = value
  }
  const incomeName = one(query.incomeName)
  if (scope === 'INCOME' && incomeName.length <= 100 && incomeName) result.incomeName = incomeName
  return clearIncompatibleReportFilters(result, scope)
}

export function reportRouteQuery(filters: ReportFilters): LocationQueryRaw {
  const result: LocationQueryRaw = {
    ...(filters.query ? { q: filters.query } : {}), scope: filters.scope, range: filters.range,
    ...(filters.range === 'CUSTOM' ? { startDate: filters.startDate, endDate: filters.endDate } : {}),
  }
  for (const key of UUID_KEYS) if (filters[key]) result[key] = filters[key]
  if (filters.incomeName) result.incomeName = filters.incomeName
  return result
}

export function adaptiveGrain(filters: ReportFilters): ReportTimeGrain {
  if (filters.range === 'THIS_YEAR') return 'MONTH'
  if (filters.range !== 'CUSTOM' || !filters.startDate || !filters.endDate) return 'DAY'
  const days = Math.floor((Date.parse(filters.endDate) - Date.parse(filters.startDate)) / 86400000) + 1
  return days > 730 ? 'YEAR' : days > 180 ? 'MONTH' : days > 62 ? 'WEEK' : 'DAY'
}

export function parseReportPresentation(query: LocationQuery, filters: ReportFilters): ReportPresentation {
  const dimensions: ReportDimension[] = ['OVERVIEW', 'TIME',
    ...(filters.scope === 'EXPENSE' ? EXPENSE_DIMENSIONS : []),
    ...(filters.scope === 'INCOME' ? INCOME_DIMENSIONS : []),
  ]
  const grains: ReportTimeGrain[] = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']
  const metrics: ReportTimeMetric[] = ['TOTAL_INCOME', 'GROSS_EXPENSE', 'ADJUSTMENT', 'NET_EXPENSE', 'BALANCE']
  const rawDimension = one(query.dimension) as ReportDimension
  const rawGrain = one(query.grain) as ReportTimeGrain
  const rawMetric = one(query.metric) as ReportTimeMetric
  const allowed = filters.scope === 'INCOME' ? ['TOTAL_INCOME'] : filters.scope === 'EXPENSE'
    ? ['GROSS_EXPENSE', 'ADJUSTMENT', 'NET_EXPENSE'] : metrics
  return {
    dimension: dimensions.includes(rawDimension) ? rawDimension : 'OVERVIEW',
    grain: grains.includes(rawGrain) ? rawGrain : adaptiveGrain(filters),
    metric: allowed.includes(rawMetric) ? rawMetric : filters.scope === 'INCOME' ? 'TOTAL_INCOME'
      : filters.scope === 'EXPENSE' ? 'NET_EXPENSE' : 'BALANCE',
  }
}

export function isExpenseDimension(dimension: ReportDimension, scope: ReportScope): dimension is ExpenseReportDimension {
  return scope === 'EXPENSE' && EXPENSE_DIMENSIONS.includes(dimension as ExpenseReportDimension)
}

export function isIncomeDimension(dimension: ReportDimension, scope: ReportScope): dimension is IncomeReportDimension {
  return scope === 'INCOME' && INCOME_DIMENSIONS.includes(dimension as IncomeReportDimension)
}

export function reportPresentationQuery(filters: ReportFilters, presentation: ReportPresentation): LocationQueryRaw {
  return { ...reportRouteQuery(filters), dimension: presentation.dimension,
    ...(presentation.dimension === 'TIME' ? { grain: presentation.grain, metric: presentation.metric } : {}) }
}

export function clearIncompatibleReportFilters(filters: ReportFilters, scope: ReportScope): ReportFilters {
  const common = {
    query: filters.query, scope, range: filters.range, startDate: filters.startDate,
    endDate: filters.endDate, fundingChannelId: filters.fundingChannelId,
  }
  if (scope === 'EXPENSE') return { ...common, primaryCategoryId: filters.primaryCategoryId,
    secondaryCategoryId: filters.secondaryCategoryId, productId: filters.productId,
    purchaseChannelId: filters.purchaseChannelId, locationLabelId: filters.locationLabelId }
  if (scope === 'INCOME') return { ...common, incomeCategoryId: filters.incomeCategoryId,
    payerId: filters.payerId, incomeName: filters.incomeName }
  return common
}

export function clearedReportFilters(defaultRange: LedgerDateRange, scope: ReportScope = 'ALL'): ReportFilters {
  return { query: '', scope, range: defaultRange }
}

export const reportScopeOptions = [
  { value: 'ALL', label: '全部' }, { value: 'EXPENSE', label: '支出' }, { value: 'INCOME', label: '收入' },
] as const
