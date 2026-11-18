import { expect, it } from 'vitest'
import { parseReportPresentation, parseReportRoute, reportPresentationQuery } from './reportQuery'
import { ledgerRouteQuery, parseLedgerRoute } from './ledgerQuery'
import { bucketStart, nextBucket, previousBusinessYear, resolveLedgerDateRange } from './businessDates'
it.each(['长', '😀'])('报表 200 码点搜索/精确名称及下钻往返，201 拒绝：%s', char => {
  const query = { scope: 'INCOME', range: 'CUSTOM', startDate: '2024-02-29', endDate: '2024-03-01', q: char.repeat(200), incomeName: char.repeat(200), dimension: 'TIME', grain: 'QUARTER', metric: 'TOTAL_INCOME' }
  const filters = parseReportRoute(query, 'THIS_MONTH'), view = parseReportPresentation(query, filters)
  expect(filters.query).toBe(query.q)
  expect(filters.incomeName).toBe(query.incomeName)
  expect(parseReportRoute({ ...query, q: query.q + char, incomeName: query.incomeName + char }, 'THIS_MONTH').incomeName).toBeUndefined()
  expect(parseReportRoute({ ...query, q: query.q + char }, 'THIS_MONTH').query).toBe('')
  const { scope, ...rest } = filters
  const parsed = parseLedgerRoute(ledgerRouteQuery({ ...rest, type: 'INCOME', lifecycle: 'ACTIVE' }, { scope, dimension: 'TIME', value: '2024-02-29/2024-03-01', reportScroll: 123,
    reportQuery: reportPresentationQuery(filters, view) }) as Record<string, string>)
  const restored = parseReportRoute(parsed.drill!.reportQuery as Record<string, string>, 'THIS_MONTH')
  expect(restored).toEqual(filters)
  expect(parseReportPresentation(parsed.drill!.reportQuery as Record<string, string>, restored)).toEqual(view)
  expect(parsed.drill!.reportScroll).toBe(123)
})
it('自然日历不依赖设备时区，周一/季度/闰年采用日历边界', () => {
  expect(bucketStart('2026-01-04', 'WEEK')).toBe('2025-12-29')
  expect(bucketStart('2026-03-31', 'QUARTER')).toBe('2026-01-01')
  expect(nextBucket('2026-10-01', 'QUARTER')).toBe('2027-01-01')
  expect(previousBusinessYear('2024-02-29')).toBe('2023-02-28')
  expect(resolveLedgerDateRange({ range: 'TODAY' }, new Date('2025-12-31T16:00:00Z'))).toEqual(['2026-01-01', '2026-01-01'])
})
