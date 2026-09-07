import { describe, expect, it } from 'vitest'

import { clearedLedgerFilters, ledgerRouteQuery, parseLedgerRoute } from './ledgerQuery'

describe('ledger route query', () => {
  it('parses reproducible filters and valid report drill context', () => {
    const parsed = parseLedgerRoute({
      q: '早餐', type: 'EXPENSE', range: 'CUSTOM', startDate: '2026-08-01', endDate: '2026-08-31',
      fundingChannelId: '123e4567-e89b-42d3-a456-426614174000', from: 'reports', scope: 'EXPENSE',
      dimension: 'category', value: '餐饮', reportRange: 'THIS_MONTH', reportScroll: '320',
    })
    expect(parsed.filters).toMatchObject({ query: '早餐', type: 'EXPENSE', range: 'CUSTOM', startDate: '2026-08-01' })
    expect(parsed.drill).toMatchObject({ scope: 'EXPENSE', dimension: 'category', value: '餐饮', reportScroll: 320 })
    expect(parsed.drill?.reportQuery).toEqual({ range: 'THIS_MONTH', scroll: '320' })
    expect(ledgerRouteQuery(parsed.filters, parsed.drill)).toMatchObject({ reportRange: 'THIS_MONTH', reportScroll: '320' })
  })

  it('drops invalid fields and unsafe drill context', () => {
    const parsed = parseLedgerRoute({ type: 'TRANSFER', range: 'CUSTOM', startDate: 'bad', endDate: '2026-01-01',
      fundingChannelId: 'not-uuid', from: 'reports', scope: 'ALL', dimension: '../bad', value: 'x' }, 'THIS_WEEK')
    expect(parsed).toEqual({ filters: { query: '', type: 'ALL', range: 'THIS_WEEK' } })
    expect(ledgerRouteQuery(parsed.filters)).toEqual({ type: 'ALL', range: 'THIS_WEEK' })
  })

  it('clears search and advanced filters back to the user default range', () => {
    expect(clearedLedgerFilters('THIS_MONTH')).toEqual({ query: '', type: 'ALL', range: 'THIS_MONTH' })
  })

  it('accepts adjustment as a ledger filter but never as a report drill scope', () => {
    expect(parseLedgerRoute({ type: 'ADJUSTMENT', range: 'TODAY' }).filters.type).toBe('ADJUSTMENT')
    expect(parseLedgerRoute({ type: 'ADJUSTMENT', range: 'TODAY', from: 'reports', scope: 'ADJUSTMENT',
      dimension: 'type', value: '退款' }).drill).toBeUndefined()
  })
})
