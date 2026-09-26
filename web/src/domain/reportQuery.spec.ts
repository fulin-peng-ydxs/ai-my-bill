import { describe, expect, it } from 'vitest'

import { clearIncompatibleReportFilters, clearedReportFilters, parseReportRoute, reportRouteQuery } from './reportQuery'

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
})
