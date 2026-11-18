import { expect, it } from 'vitest'
import { clearIncompatibleLedgerFilters, clearedLedgerFilters, ledgerRouteQuery, parseLedgerRoute } from './ledgerQuery'
it('类型切换清理另一类专属字段，共同条件和清除基线保持', () => {
  const expense = { query: '中文', type: 'EXPENSE' as const, lifecycle: 'ACTIVE' as const, range: 'THIS_MONTH' as const,
    productId: 'p', missingLocation: true, payerId: 'payer', incomeName: '工资', fundingChannelId: 'cash' }
  expect(clearIncompatibleLedgerFilters(expense)).toEqual({ query: '中文', type: 'EXPENSE', lifecycle: 'ACTIVE', range: 'THIS_MONTH', productId: 'p', missingLocation: true, fundingChannelId: 'cash' })
  expect(clearIncompatibleLedgerFilters({ ...expense, type: 'INCOME' })).not.toHaveProperty('productId')
  expect(clearIncompatibleLedgerFilters({ ...expense, type: 'ALL' })).not.toHaveProperty('incomeName')
  expect(clearedLedgerFilters('THIS_YEAR', 'TRASHED')).toEqual({ query: '', type: 'ALL', lifecycle: 'TRASHED', range: 'THIS_YEAR' })
})
it('下钻路由白名单往返，清除筛选结束来源，非法上下文降级', () => {
  const route = { q: '中文', type: 'EXPENSE', range: 'THIS_MONTH', from: 'reports', scope: 'EXPENSE', dimension: 'CATEGORY', value: 'food', label: '食品',
    reportRange: 'THIS_MONTH', reportDimension: 'CATEGORY', reportScroll: '420', reportSecret: 'ignored' }
  const parsed = parseLedgerRoute(route)
  expect(parsed.drill?.reportScroll).toBe(420)
  expect(parsed.drill?.reportQuery).toEqual({ range: 'THIS_MONTH', dimension: 'CATEGORY', scroll: '420' })
  expect(parseLedgerRoute(ledgerRouteQuery(parsed.filters, parsed.drill) as Record<string, string>)).toEqual(parsed)
  expect(ledgerRouteQuery(clearedLedgerFilters('TODAY'))).not.toHaveProperty('from')
  expect(parseLedgerRoute({ ...route, dimension: 'bad/value' }).drill).toBeUndefined()
})

it.each(['长', '😀'])('200 字符收入精确名称和下钻值完整往返：%s', char => {
  const name = char.repeat(200)
  const result = parseLedgerRoute({ type: 'INCOME', incomeName: name, from: 'reports', scope: 'INCOME', dimension: 'NAME', value: name })
  expect(result.filters.incomeName).toBe(name)
  expect(parseLedgerRoute({ type: 'INCOME', incomeName: name + char }).filters.incomeName).toBeUndefined()
  expect(parseLedgerRoute({ q: name }).filters.query).toBe(name)
  expect(result.drill?.value).toBe(name)
  expect(parseLedgerRoute(ledgerRouteQuery(result.filters, result.drill) as Record<string, string>)).toEqual(result)
})
