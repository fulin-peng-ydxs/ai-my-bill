import type { LedgerFilters } from '../api/ledgerEntries'
import type { ReportTimeGrain } from '../api/reports'
import { formatShanghaiBusinessDate } from './businessTime'

/** YYYY-MM-DD 只表示自然日；UTC 日期运算不受设备时区或夏令时影响。 */
export function isBusinessDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function dateText(date: Date): string {
  const value = date.toISOString().slice(0, 10)
  if (!isBusinessDate(value)) throw new RangeError('日期超出支持范围。')
  return value
}
export function addBusinessDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return dateText(date)
}
/** LocalDate.minusYears 语义：闰日退到目标年份二月最后一天。 */
export function previousBusinessYear(value: string): string {
  const date = new Date(`${value}T00:00:00Z`), day = date.getUTCDate()
  date.setUTCFullYear(date.getUTCFullYear() - 1, date.getUTCMonth(), 1)
  const end = new Date(date)
  end.setUTCMonth(end.getUTCMonth() + 1, 0)
  date.setUTCDate(Math.min(day, end.getUTCDate()))
  return dateText(date)
}
export function businessDayCount(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
}
export function bucketStart(value: string, grain: ReportTimeGrain): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (grain === 'WEEK') return addBusinessDays(value, -(date.getUTCDay() + 6) % 7)
  if (grain !== 'DAY') date.setUTCDate(1)
  if (grain === 'QUARTER') date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3)
  if (grain === 'YEAR') date.setUTCMonth(0)
  return dateText(date)
}
export function nextBucket(value: string, grain: ReportTimeGrain): string {
  if (grain === 'DAY' || grain === 'WEEK') return addBusinessDays(value, grain === 'DAY' ? 1 : 7)
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + (grain === 'MONTH' ? 1 : grain === 'QUARTER' ? 3 : 12))
  return dateText(date)
}
export function bucketLabel(start: string, end: string, grain: ReportTimeGrain): string {
  const short = (value: string) => `${Number(value.slice(5, 7))}月${Number(value.slice(8))}日`
  return grain === 'DAY' ? short(start) : grain === 'WEEK' ? `${short(start)}–${short(end)}`
    : grain === 'MONTH' ? `${start.slice(0, 4)}年${Number(start.slice(5, 7))}月`
      : grain === 'QUARTER' ? `${start.slice(0, 4)}年Q${Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1}`
        : `${start.slice(0, 4)}年`
}
export function resolveLedgerDateRange(filters: Pick<LedgerFilters, 'range' | 'startDate' | 'endDate'>, now: Date): [string, string] {
  const today = formatShanghaiBusinessDate(now)
  switch (filters.range) {
    case 'TODAY': return [today, today]
    case 'THIS_WEEK': return [bucketStart(today, 'WEEK'), today]
    case 'THIS_MONTH': return [`${today.slice(0, 7)}-01`, today]
    case 'THIS_YEAR': return [`${today.slice(0, 4)}-01-01`, today]
    case 'LAST_MONTH': {
      const end = addBusinessDays(`${today.slice(0, 7)}-01`, -1)
      return [`${end.slice(0, 7)}-01`, end]
    }
    case 'CUSTOM': if (isBusinessDate(filters.startDate) && isBusinessDate(filters.endDate) && filters.startDate <= filters.endDate) return [filters.startDate, filters.endDate]
  }
  throw new RangeError('请选择有效的日期范围。')
}
