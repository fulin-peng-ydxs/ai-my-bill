import type { components } from './generated/schema'
import { EntryReadbackQuery } from '../data/entries/readbackQuery'
import { appDatabase } from '../data/appDatabase'
import { localOperation } from '../data/localOperation'

const readback = new EntryReadbackQuery(appDatabase)

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
  return localOperation(() => readback.list(filters, cursor, signal))
}
