import type { components } from './generated/schema'
import { apiRequest } from './http'

export type LedgerItem = components['schemas']['LedgerItem']
export type LedgerPage = components['schemas']['LedgerPage']
export type LedgerEntryTypeFilter = components['schemas']['LedgerEntryTypeFilter']
export type LedgerDateRange = components['schemas']['LedgerDateRange']
export type LedgerLifecycleFilter = components['schemas']['LedgerLifecycleFilter']

export interface LedgerFilters {
  query: string
  type: LedgerEntryTypeFilter
  lifecycle: LedgerLifecycleFilter
  fundingChannelId?: string
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
  if (filters.range === 'CUSTOM' && filters.startDate && filters.endDate) {
    params.set('startDate', filters.startDate)
    params.set('endDate', filters.endDate)
  }
  if (cursor) params.set('cursor', cursor)
  return apiRequest(`/ledger-entries?${params}`, { signal })
}
