import type { LocationQuery, LocationQueryRaw } from 'vue-router'

import type { ExpenseTimeBand, LedgerDateRange, LedgerEntryTypeFilter, LedgerFilters, LedgerLifecycleFilter } from '../api/ledgerEntries'

const TYPES: readonly LedgerEntryTypeFilter[] = ['ALL', 'EXPENSE', 'INCOME', 'ADJUSTMENT', 'EXPENSE_FLOW']
const DRILL_SCOPES: readonly LedgerDrillContext['scope'][] = ['ALL', 'EXPENSE', 'INCOME']
const RANGES: readonly LedgerDateRange[] = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'CUSTOM']
const LIFECYCLES: readonly LedgerLifecycleFilter[] = ['ACTIVE', 'TRASHED']
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CONTEXT_TOKEN = /^[\p{L}\p{N}_-]{1,64}$/u
const ADVANCED_UUID_KEYS = [
  'primaryCategoryId', 'secondaryCategoryId', 'productId', 'unitId', 'purchaseChannelId',
  'locationLabelId', 'incomeCategoryId', 'payerId', 'entryId',
] as const
const TIME_BANDS: readonly ExpenseTimeBand[] = ['NIGHT', 'MORNING', 'AFTERNOON', 'EVENING']

export interface LedgerDrillContext {
  scope: 'ALL' | 'EXPENSE' | 'INCOME'
  dimension: string
  value: string
  label?: string
  reportQuery: LocationQueryRaw
  reportScroll: number
}

export interface ParsedLedgerRoute {
  filters: LedgerFilters
  drill?: LedgerDrillContext
}

function one(value: LocationQuery[string]): string {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value)
}

/** URL 只接受白名单字段；任一非法下钻元数据都降级为普通明细，不透传未知报告参数。 */
export function parseLedgerRoute(query: LocationQuery, defaultRange: LedgerDateRange = 'TODAY'): ParsedLedgerRoute {
  const rawType = one(query.type)
  const type = TYPES.includes(rawType as LedgerEntryTypeFilter) ? rawType as LedgerEntryTypeFilter : 'ALL'
  const rawRange = one(query.range)
  const rawLifecycle = one(query.lifecycle)
  const lifecycle = LIFECYCLES.includes(rawLifecycle as LedgerLifecycleFilter)
    ? rawLifecycle as LedgerLifecycleFilter : 'ACTIVE'
  let range = RANGES.includes(rawRange as LedgerDateRange) ? rawRange as LedgerDateRange : defaultRange
  const rawStart = one(query.startDate)
  const rawEnd = one(query.endDate)
  const validCustom = validDate(rawStart) && validDate(rawEnd) && rawStart <= rawEnd
  if (range === 'CUSTOM' && !validCustom) range = defaultRange
  const rawFunding = one(query.fundingChannelId)
  const rawSearch = one(query.q)
  const filters: LedgerFilters = {
    query: rawSearch.length <= 200 ? rawSearch : '',
    type,
    lifecycle,
    range,
    ...(UUID.test(rawFunding) ? { fundingChannelId: rawFunding } : {}),
    ...(range === 'CUSTOM' && validCustom ? { startDate: rawStart, endDate: rawEnd } : {}),
  }
  for (const key of ADVANCED_UUID_KEYS) {
    const value = one(query[key])
    if (UUID.test(value)) filters[key] = value
  }
  const incomeName = one(query.incomeName)
  if (incomeName && incomeName.length <= 100) filters.incomeName = incomeName
  for (const key of ['missingSecondaryCategory', 'missingPurchaseChannel', 'missingLocation'] as const) {
    if (one(query[key]) === 'true') filters[key] = true
  }
  const weekday = Number.parseInt(one(query.expenseWeekday), 10)
  if (weekday >= 1 && weekday <= 7) filters.expenseWeekday = weekday
  const timeBand = one(query.expenseTimeBand) as ExpenseTimeBand
  if (TIME_BANDS.includes(timeBand)) filters.expenseTimeBand = timeBand

  if (one(query.from) !== 'reports') return { filters }
  const scope = one(query.scope)
  const dimension = one(query.dimension)
  const value = one(query.value)
  const label = one(query.label)
  if (!DRILL_SCOPES.includes(scope as LedgerDrillContext['scope']) || !CONTEXT_TOKEN.test(dimension) || !value || value.length > 100) {
    return { filters }
  }
  const reportScroll = Number.parseInt(one(query.reportScroll), 10)
  const reportQuery: LocationQueryRaw = {}
  for (const key of ['reportRange', 'reportScope', 'reportFundingChannelId', 'reportQ', 'reportDimension',
    'reportStartDate', 'reportEndDate', 'reportPrimaryCategoryId', 'reportSecondaryCategoryId',
    'reportProductId', 'reportPurchaseChannelId', 'reportLocationLabelId', 'reportIncomeCategoryId',
    'reportPayerId', 'reportIncomeName', 'reportGrain', 'reportMetric']) {
    const candidate = one(query[key])
    if (candidate && candidate.length <= 200) reportQuery[key.replace(/^report/, '').replace(/^./, (char) => char.toLowerCase())] = candidate
  }
  if (Number.isSafeInteger(reportScroll) && reportScroll >= 0) reportQuery.scroll = String(reportScroll)
  return { filters, drill: { scope: scope as LedgerDrillContext['scope'], dimension, value,
    ...(label && label.length <= 220 ? { label } : {}), reportQuery,
    reportScroll: Number.isSafeInteger(reportScroll) && reportScroll >= 0 ? reportScroll : 0 } }
}

export function ledgerRouteQuery(filters: LedgerFilters, drill?: LedgerDrillContext): LocationQueryRaw {
  const result: LocationQueryRaw = {
    ...(filters.query ? { q: filters.query } : {}),
    type: filters.type,
    ...(filters.lifecycle === 'TRASHED' ? { lifecycle: filters.lifecycle } : {}),
    range: filters.range,
    ...(filters.fundingChannelId ? { fundingChannelId: filters.fundingChannelId } : {}),
    ...(filters.range === 'CUSTOM' ? { startDate: filters.startDate, endDate: filters.endDate } : {}),
    ...(drill ? { from: 'reports', scope: drill.scope, dimension: drill.dimension, value: drill.value,
      ...(drill.label ? { label: drill.label } : {}) } : {}),
  }
  for (const key of [...ADVANCED_UUID_KEYS, 'incomeName'] as const) if (filters[key]) result[key] = filters[key]
  for (const key of ['missingSecondaryCategory', 'missingPurchaseChannel', 'missingLocation'] as const) {
    if (filters[key]) result[key] = 'true'
  }
  if (filters.expenseWeekday) result.expenseWeekday = String(filters.expenseWeekday)
  if (filters.expenseTimeBand) result.expenseTimeBand = filters.expenseTimeBand
  if (drill) {
    if (Number.isSafeInteger(drill.reportScroll) && drill.reportScroll >= 0) result.reportScroll = String(drill.reportScroll)
    for (const [key, value] of Object.entries(drill.reportQuery)) {
      if (typeof value !== 'string') continue
      if (key === 'scroll') continue
      const reportKey = `report${key.charAt(0).toUpperCase()}${key.slice(1)}`
      result[reportKey] = value
    }
  }
  return result
}

export function clearedLedgerFilters(defaultRange: LedgerDateRange, lifecycle: LedgerLifecycleFilter = 'ACTIVE'): LedgerFilters {
  return { query: '', type: 'ALL', lifecycle, range: defaultRange }
}

export const ledgerTypeOptions = [
  { value: 'ALL', label: '全部' }, { value: 'EXPENSE', label: '支出' }, { value: 'INCOME', label: '收入' },
  { value: 'ADJUSTMENT', label: '退款与报销' },
  { value: 'EXPENSE_FLOW', label: '净支出构成' },
] as const

export const ledgerLifecycleOptions = [
  { value: 'ACTIVE', label: '有效账单' }, { value: 'TRASHED', label: '回收站' },
] as const

export const ledgerRangeOptions = [
  { value: 'TODAY', label: '今天' }, { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' }, { value: 'LAST_MONTH', label: '上月' },
  { value: 'THIS_YEAR', label: '今年' }, { value: 'CUSTOM', label: '指定日期' },
] as const

export function optionLabel(options: readonly { value: string, label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}
