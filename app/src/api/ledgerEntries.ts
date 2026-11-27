import type { LedgerContracts } from '../domain/ledgerContracts'
import { EntryReadbackQuery } from '../data/entries/readbackQuery'
import { appDatabase } from '../data/appDatabase'
import { localOperation } from '../data/localOperation'

const readback = new EntryReadbackQuery(appDatabase)

export type LedgerItem = LedgerContracts['LedgerItem']
export type LedgerPage = LedgerContracts['LedgerPage']
export type LedgerEntryTypeFilter = LedgerContracts['LedgerEntryTypeFilter']
export type LedgerDateRange = LedgerContracts['LedgerDateRange']
export type LedgerLifecycleFilter = LedgerContracts['LedgerLifecycleFilter']
export type ExpenseTimeBand = LedgerContracts['ExpenseTimeBand']

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
