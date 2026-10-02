import { describe, expect, it } from 'vitest'
import { hasFilterChanges } from './filterChanges'
import { clearedLedgerFilters } from './ledgerQuery'
import { clearedReportFilters } from './reportQuery'

describe('filter reset availability', () => {
  it('does not offer reset for the current default date or a retained scope', () => {
    const defaults = clearedReportFilters('THIS_MONTH', 'EXPENSE')
    expect(hasFilterChanges({ ...defaults, fundingChannelId: undefined }, defaults)).toBe(false)
    expect(hasFilterChanges(clearedLedgerFilters('TODAY', 'TRASHED'), clearedLedgerFilters('TODAY', 'TRASHED'))).toBe(false)
  })
  it('detects search, types, custom dates and otherwise invisible drill constraints', () => {
    const defaults = clearedLedgerFilters('TODAY')
    for (const patch of [{ query: '咖啡' }, { type: 'EXPENSE' as const }, { range: 'CUSTOM' as const, startDate: '2026-10-01', endDate: '2026-10-02' }, { missingLocation: true }, { expenseWeekday: 1 }, { entryId: 'entry-1' }]) {
      expect(hasFilterChanges({ ...defaults, ...patch }, defaults)).toBe(true)
    }
  })
})
