import type { components } from './generated/schema'
import { apiRequest } from './http'

export type ReportScope = components['schemas']['ReportScope']
export type ReportSummary = components['schemas']['ReportSummary']

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
  const params = new URLSearchParams({ query: filters.query, scope: filters.scope, range: filters.range })
  for (const key of OPTIONAL_KEYS) if (filters[key]) params.set(key, filters[key])
  if (filters.range === 'CUSTOM' && filters.startDate && filters.endDate) {
    params.set('startDate', filters.startDate)
    params.set('endDate', filters.endDate)
  }
  return apiRequest(`/reports/summary?${params}`, { signal })
}
