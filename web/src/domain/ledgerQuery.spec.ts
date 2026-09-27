import { describe, expect, it } from 'vitest'

import { clearedLedgerFilters, ledgerRouteQuery, parseLedgerRoute } from './ledgerQuery'

describe('ledger route query', () => {
  it('parses reproducible filters and valid report drill context', () => {
    const parsed = parseLedgerRoute({
      q: '早餐', type: 'EXPENSE', range: 'CUSTOM', startDate: '2026-08-01', endDate: '2026-08-31',
      fundingChannelId: '123e4567-e89b-42d3-a456-426614174000', from: 'reports', scope: 'EXPENSE',
      productId: '123e4567-e89b-42d3-a456-426614174000', dimension: 'category', value: '餐饮',
      reportRange: 'THIS_MONTH', reportScope: 'EXPENSE', reportProductId: '123e4567-e89b-42d3-a456-426614174000', reportScroll: '320',
    })
    expect(parsed.filters).toMatchObject({ query: '早餐', type: 'EXPENSE', lifecycle: 'ACTIVE', range: 'CUSTOM', startDate: '2026-08-01' })
    expect(parsed.drill).toMatchObject({ scope: 'EXPENSE', dimension: 'category', value: '餐饮', reportScroll: 320 })
    expect(parsed.filters.productId).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(parsed.drill?.reportQuery).toEqual({ range: 'THIS_MONTH', scope: 'EXPENSE',
      productId: '123e4567-e89b-42d3-a456-426614174000', scroll: '320' })
    expect(ledgerRouteQuery(parsed.filters, parsed.drill)).toMatchObject({ reportRange: 'THIS_MONTH',
      reportScope: 'EXPENSE', reportProductId: '123e4567-e89b-42d3-a456-426614174000', reportScroll: '320' })
  })

  it('drops invalid fields and unsafe drill context', () => {
    const parsed = parseLedgerRoute({ type: 'TRANSFER', range: 'CUSTOM', startDate: 'bad', endDate: '2026-01-01',
      fundingChannelId: 'not-uuid', from: 'reports', scope: 'ALL', dimension: '../bad', value: 'x' }, 'THIS_WEEK')
    expect(parsed).toEqual({ filters: { query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'THIS_WEEK' } })
    expect(ledgerRouteQuery(parsed.filters)).toEqual({ type: 'ALL', range: 'THIS_WEEK' })
  })

  it('clears search and advanced filters back to the user default range', () => {
    expect(clearedLedgerFilters('THIS_MONTH')).toEqual({ query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'THIS_MONTH' })
  })

  it('accepts adjustment as a ledger filter but never as a report drill scope', () => {
    expect(parseLedgerRoute({ type: 'ADJUSTMENT', range: 'TODAY' }).filters.type).toBe('ADJUSTMENT')
    expect(parseLedgerRoute({ type: 'ADJUSTMENT', range: 'TODAY', from: 'reports', scope: 'ADJUSTMENT',
      dimension: 'type', value: '退款' }).drill).toBeUndefined()
  })

  it('round-trips the net-expense time drill and its report return state', () => {
    const parsed = parseLedgerRoute({
      type: 'EXPENSE_FLOW', range: 'CUSTOM', startDate: '2026-09-07', endDate: '2026-09-13',
      from: 'reports', scope: 'EXPENSE', dimension: 'TIME', value: '2026-09-07/2026-09-13',
      reportDimension: 'TIME', reportGrain: 'WEEK', reportMetric: 'NET_EXPENSE',
      reportRange: 'CUSTOM', reportStartDate: '2026-09-01', reportEndDate: '2026-09-15',
    })

    expect(parsed.filters).toMatchObject({
      type: 'EXPENSE_FLOW', range: 'CUSTOM', startDate: '2026-09-07', endDate: '2026-09-13',
    })
    expect(parsed.drill).toMatchObject({ scope: 'EXPENSE', dimension: 'TIME', value: '2026-09-07/2026-09-13' })
    expect(parsed.drill?.reportQuery).toEqual({
      range: 'CUSTOM', startDate: '2026-09-01', endDate: '2026-09-15',
      dimension: 'TIME', grain: 'WEEK', metric: 'NET_EXPENSE',
    })
    expect(ledgerRouteQuery(parsed.filters, parsed.drill)).toMatchObject({
      type: 'EXPENSE_FLOW', reportDimension: 'TIME', reportGrain: 'WEEK', reportMetric: 'NET_EXPENSE',
    })
  })

  it('serializes the authoritative report scroll even when reportQuery has no scroll field', () => {
    const query = ledgerRouteQuery({ query: '', type: 'INCOME', lifecycle: 'ACTIVE', range: 'THIS_MONTH' }, {
      scope: 'INCOME', dimension: 'OVERVIEW', value: 'INCOME', reportQuery: { scope: 'INCOME' }, reportScroll: 480,
    })
    expect(query).toMatchObject({ from: 'reports', reportScope: 'INCOME', reportScroll: '480' })
  })

  it('round-trips derived expense drill filters without accepting invalid values', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const parsed = parseLedgerRoute({ type: 'EXPENSE', range: 'THIS_MONTH', unitId: id, entryId: id,
      missingLocation: 'true', missingPurchaseChannel: 'false', expenseWeekday: '7', expenseTimeBand: 'EVENING' })
    expect(parsed.filters).toMatchObject({ unitId: id, entryId: id, missingLocation: true,
      expenseWeekday: 7, expenseTimeBand: 'EVENING' })
    expect(ledgerRouteQuery(parsed.filters)).toMatchObject({ unitId: id, entryId: id, missingLocation: 'true',
      expenseWeekday: '7', expenseTimeBand: 'EVENING' })
    expect(parseLedgerRoute({ expenseWeekday: '8', expenseTimeBand: 'INVALID' }).filters)
      .not.toHaveProperty('expenseWeekday')
  })

  it('keeps the recycle-bin dataset explicit and clears only its business filters', () => {
    const parsed = parseLedgerRoute({ lifecycle: 'TRASHED', type: 'INCOME', range: 'THIS_MONTH' })
    expect(parsed.filters.lifecycle).toBe('TRASHED')
    expect(ledgerRouteQuery(parsed.filters)).toMatchObject({ lifecycle: 'TRASHED' })
    expect(clearedLedgerFilters('TODAY', 'TRASHED')).toEqual({
      query: '', type: 'ALL', lifecycle: 'TRASHED', range: 'TODAY',
    })
  })
})
