import type { components } from './generated/schema'
import { apiRequest } from './http'

export type LedgerItem = components['schemas']['LedgerItem']
export type LedgerPage = components['schemas']['LedgerPage']
export type LedgerEntryTypeFilter = components['schemas']['LedgerEntryTypeFilter']
export type LedgerDateRange = components['schemas']['LedgerDateRange']
export type LedgerLifecycleFilter = components['schemas']['LedgerLifecycleFilter']
export type ExpenseTimeBand = components['schemas']['ExpenseTimeBand']

export interface LedgerFilters {
  query: string
  type: LedgerEntryTypeFilter
  lifecycle: LedgerLifecycleFilter
  fundingChannelId?: string
  primaryCategoryId?: string
  secondaryCategoryId?: string
  productId?: string
  unitId?: string
  purchaseChannelId?: string
  locationLabelId?: string
  incomeCategoryId?: string
  payerId?: string
  incomeName?: string
  entryId?: string
  missingSecondaryCategory?: boolean
  missingPurchaseChannel?: boolean
  missingLocation?: boolean
  expenseWeekday?: number
  expenseTimeBand?: ExpenseTimeBand
  range: LedgerDateRange
  startDate?: string
  endDate?: string
}

export function listLedgerEntries(
  filters: LedgerFilters,
  cursor?: string,
  signal?: AbortSignal,
): Promise<LedgerPage> {
  const params = new URLSearchParams({ query: filters.query, type: filters.type, lifecycle: filters.lifecycle, range: filters.range })
  if (filters.fundingChannelId) params.set('fundingChannelId', filters.fundingChannelId)
  for (const key of ['primaryCategoryId', 'secondaryCategoryId', 'productId', 'unitId', 'purchaseChannelId',
    'locationLabelId', 'incomeCategoryId', 'payerId', 'incomeName', 'entryId'] as const) {
    if (filters[key]) params.set(key, filters[key])
  }
  for (const key of ['missingSecondaryCategory', 'missingPurchaseChannel', 'missingLocation'] as const) {
    if (filters[key]) params.set(key, 'true')
  }
  if (filters.expenseWeekday) params.set('expenseWeekday', String(filters.expenseWeekday))
  if (filters.expenseTimeBand) params.set('expenseTimeBand', filters.expenseTimeBand)
  if (filters.range === 'CUSTOM' && filters.startDate && filters.endDate) {
    params.set('startDate', filters.startDate)
    params.set('endDate', filters.endDate)
  }
  if (cursor) params.set('cursor', cursor)
  return apiRequest(`/ledger-entries?${params}`, { signal })
}
