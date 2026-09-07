import type { LocationQuery, LocationQueryRaw } from 'vue-router'

import type { LedgerDateRange, LedgerEntryTypeFilter, LedgerFilters } from '../api/ledgerEntries'

const TYPES: readonly LedgerEntryTypeFilter[] = ['ALL', 'EXPENSE', 'INCOME']
const RANGES: readonly LedgerDateRange[] = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'CUSTOM']
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CONTEXT_TOKEN = /^[\p{L}\p{N}_-]{1,64}$/u

export interface LedgerDrillContext {
  scope: 'ALL' | 'EXPENSE' | 'INCOME'
  dimension: string
  value: string
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
    range,
    ...(UUID.test(rawFunding) ? { fundingChannelId: rawFunding } : {}),
    ...(range === 'CUSTOM' && validCustom ? { startDate: rawStart, endDate: rawEnd } : {}),
  }

  if (one(query.from) !== 'reports') return { filters }
  const scope = one(query.scope)
  const dimension = one(query.dimension)
  const value = one(query.value)
  if (!TYPES.includes(scope as LedgerEntryTypeFilter) || !CONTEXT_TOKEN.test(dimension) || !value || value.length > 100) {
    return { filters }
  }
  const reportScroll = Number.parseInt(one(query.reportScroll), 10)
  const reportQuery: LocationQueryRaw = {}
  for (const key of ['reportRange', 'reportType', 'reportFundingChannelId', 'reportQ', 'reportDimension']) {
    const candidate = one(query[key])
    if (candidate && candidate.length <= 200) reportQuery[key.replace(/^report/, '').replace(/^./, (char) => char.toLowerCase())] = candidate
  }
  if (Number.isSafeInteger(reportScroll) && reportScroll >= 0) reportQuery.scroll = String(reportScroll)
  return { filters, drill: { scope: scope as LedgerDrillContext['scope'], dimension, value, reportQuery, reportScroll: Number.isSafeInteger(reportScroll) && reportScroll >= 0 ? reportScroll : 0 } }
}

export function ledgerRouteQuery(filters: LedgerFilters, drill?: LedgerDrillContext): LocationQueryRaw {
  const result: LocationQueryRaw = {
    ...(filters.query ? { q: filters.query } : {}),
    type: filters.type,
    range: filters.range,
    ...(filters.fundingChannelId ? { fundingChannelId: filters.fundingChannelId } : {}),
    ...(filters.range === 'CUSTOM' ? { startDate: filters.startDate, endDate: filters.endDate } : {}),
    ...(drill ? { from: 'reports', scope: drill.scope, dimension: drill.dimension, value: drill.value } : {}),
  }
  if (drill) {
    for (const [key, value] of Object.entries(drill.reportQuery)) {
      if (typeof value !== 'string') continue
      const reportKey = key === 'scroll' ? 'reportScroll' : `report${key.charAt(0).toUpperCase()}${key.slice(1)}`
      result[reportKey] = value
    }
  }
  return result
}

export function clearedLedgerFilters(defaultRange: LedgerDateRange): LedgerFilters {
  return { query: '', type: 'ALL', range: defaultRange }
}

export const ledgerTypeOptions = [
  { value: 'ALL', label: '全部' }, { value: 'EXPENSE', label: '支出' }, { value: 'INCOME', label: '收入' },
] as const

export const ledgerRangeOptions = [
  { value: 'TODAY', label: '今天' }, { value: 'THIS_WEEK', label: '本周' },
  { value: 'THIS_MONTH', label: '本月' }, { value: 'LAST_MONTH', label: '上月' },
  { value: 'THIS_YEAR', label: '今年' }, { value: 'CUSTOM', label: '指定日期' },
] as const

export function optionLabel(options: readonly { value: string, label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}
