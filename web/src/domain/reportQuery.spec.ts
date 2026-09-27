import { describe, expect, it } from 'vitest'

import { adaptiveGrain, clearIncompatibleReportFilters, clearedReportFilters, parseReportPresentation,
  isExpenseDimension, isIncomeDimension, parseReportRoute, reportPresentationQuery, reportRouteQuery } from './reportQuery'

const ID = '123e4567-e89b-42d3-a456-426614174000'

describe('report route query', () => {
  it('round-trips a valid expense filter snapshot', () => {
    const parsed = parseReportRoute({ scope: 'EXPENSE', range: 'CUSTOM', startDate: '2026-09-01',
      endDate: '2026-09-30', q: '早餐', fundingChannelId: ID, productId: ID }, 'THIS_MONTH')
    expect(parsed).toEqual({ query: '早餐', scope: 'EXPENSE', range: 'CUSTOM', startDate: '2026-09-01',
      endDate: '2026-09-30', fundingChannelId: ID, productId: ID })
    expect(reportRouteQuery(parsed)).toMatchObject({ scope: 'EXPENSE', productId: ID, q: '早餐' })
  })

  it('drops invalid values and type-specific filters from other scopes', () => {
    expect(parseReportRoute({ scope: 'ALL', range: 'CUSTOM', startDate: 'bad', endDate: '2026-09-30',
      productId: ID, payerId: ID, fundingChannelId: 'not-an-id' }, 'THIS_WEEK')).toEqual({
      query: '', scope: 'ALL', range: 'THIS_WEEK',
    })
  })

  it('clears incompatible conditions when the scope changes', () => {
    expect(clearIncompatibleReportFilters({ query: '', scope: 'EXPENSE', range: 'THIS_MONTH', productId: ID }, 'INCOME'))
      .toEqual({ query: '', scope: 'INCOME', range: 'THIS_MONTH', startDate: undefined, endDate: undefined,
        fundingChannelId: undefined, incomeCategoryId: undefined, payerId: undefined, incomeName: undefined })
    expect(clearedReportFilters('LAST_MONTH', 'EXPENSE')).toEqual({ query: '', scope: 'EXPENSE', range: 'LAST_MONTH' })
  })

  it('parses and serializes time presentation while enforcing scope metrics', () => {
    const filters = { query: '', scope: 'EXPENSE' as const, range: 'THIS_YEAR' as const }
    expect(parseReportPresentation({ dimension: 'TIME', grain: 'QUARTER', metric: 'NET_EXPENSE' }, filters))
      .toEqual({ dimension: 'TIME', grain: 'QUARTER', metric: 'NET_EXPENSE' })
    expect(parseReportPresentation({ dimension: 'TIME', metric: 'BALANCE' }, filters).metric).toBe('NET_EXPENSE')
    expect(reportPresentationQuery(filters, { dimension: 'TIME', grain: 'MONTH', metric: 'NET_EXPENSE' }))
      .toMatchObject({ dimension: 'TIME', grain: 'MONTH', metric: 'NET_EXPENSE' })
  })

  it('adapts the default grain to the selected range', () => {
    expect(adaptiveGrain({ query: '', scope: 'ALL', range: 'THIS_YEAR' })).toBe('MONTH')
    expect(adaptiveGrain({ query: '', scope: 'ALL', range: 'CUSTOM', startDate: '2026-01-01', endDate: '2026-12-31' })).toBe('MONTH')
    expect(adaptiveGrain({ query: '', scope: 'ALL', range: 'CUSTOM', startDate: '2026-09-01', endDate: '2026-09-15' })).toBe('DAY')
  })

  it('allows expense dimensions only inside the expense scope', () => {
    const expense = { query: '', scope: 'EXPENSE' as const, range: 'THIS_MONTH' as const }
    expect(parseReportPresentation({ dimension: 'QUALITY' }, expense).dimension).toBe('QUALITY')
    expect(reportPresentationQuery(expense, { dimension: 'PRODUCT', grain: 'DAY', metric: 'NET_EXPENSE' }))
      .toMatchObject({ scope: 'EXPENSE', dimension: 'PRODUCT' })
    expect(parseReportPresentation({ dimension: 'QUALITY' }, { ...expense, scope: 'ALL' }).dimension).toBe('OVERVIEW')
  })

  it('allows income dimensions only inside the income scope and resolves shared names by scope', () => {
    const income = { query: '', scope: 'INCOME' as const, range: 'THIS_MONTH' as const }
    expect(parseReportPresentation({ dimension: 'PAYER' }, income).dimension).toBe('PAYER')
    expect(parseReportPresentation({ dimension: 'NAME' }, income).dimension).toBe('NAME')
    expect(parseReportPresentation({ dimension: 'PAYER' }, { ...income, scope: 'EXPENSE' }).dimension).toBe('OVERVIEW')
    expect(isIncomeDimension('CATEGORY', 'INCOME')).toBe(true)
    expect(isIncomeDimension('CATEGORY', 'EXPENSE')).toBe(false)
    expect(isExpenseDimension('FREQUENCY', 'EXPENSE')).toBe(true)
    expect(isExpenseDimension('FREQUENCY', 'INCOME')).toBe(false)
  })
})
