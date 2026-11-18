import type { LedgerFilters } from '../../api/ledgerEntries'
import type { ReportFilters, ReportSummary, ReportTimeGrain, TimeReport } from '../../api/reports'
import { clearIncompatibleReportFilters } from '../../domain/reportQuery'
import { LocalError, throwIfCancelled } from '../../domain/localError'
import { addBusinessDays, bucketLabel, bucketStart, businessDayCount, isBusinessDate, nextBucket, previousBusinessYear } from '../../domain/businessDates'
import { formatShanghaiBusinessDate } from '../../domain/businessTime'
import { fromSqliteInteger, scaledIntegerToDecimal } from '../../domain/money'
import { fieldError } from '../dictionaries/repository'
import { compileLedgerFilter, readbackProjection } from '../entries/querySql'
import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'

export interface CoreReport {
  /** 与金额共用本次查询时钟；总览下钻不能再次解析 TODAY 等相对范围。 */
  resolvedRange: Pick<TimeReport, 'startDate' | 'endDate'>
  summary: ReportSummary
  time?: TimeReport
}
type Totals = { income: bigint; gross: bigint; adjustment: bigint; incomeCount: number; expenseCount: number; adjustmentCount: number }
const empty = (): Totals => ({ income: 0n, gross: 0n, adjustment: 0n, incomeCount: 0, expenseCount: 0, adjustmentCount: 0 })
const money = (value: bigint) => scaledIntegerToDecimal(value, 2)
const amountFields = ['totalIncome', 'grossExpense', 'adjustmentAmount', 'netExpense', 'balance'] as const
const metrics = ['TOTAL_INCOME', 'GROSS_EXPENSE', 'ADJUSTMENT', 'NET_EXPENSE', 'BALANCE'] as const
const grains = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const
const grainSql: Record<ReportTimeGrain, string> = {
  DAY: 'business_date',
  WEEK: "date(business_date,'-' || ((CAST(strftime('%w',business_date) AS INTEGER)+6)%7) || ' days')",
  MONTH: "strftime('%Y-%m-01',business_date)",
  QUARTER: "printf('%04d-%02d-01',CAST(strftime('%Y',business_date) AS INTEGER),((CAST(strftime('%m',business_date) AS INTEGER)-1)/3)*3+1)",
  YEAR: "strftime('%Y-01-01',business_date)",
}
function amounts(t: Totals): [bigint, bigint, bigint, bigint, bigint] {
  const net = t.gross - t.adjustment
  return [t.income, t.gross, t.adjustment, net, t.income - net]
}
function summary(t: Totals, scope: ReportFilters['scope']): ReportSummary {
  const [income, gross, adjustment, net, balance] = amounts(t)
  return { totalIncome: money(income), grossExpense: money(gross), adjustmentAmount: money(adjustment), netExpense: money(net), balance: money(balance),
    matchingItemCount: t.incomeCount + t.expenseCount + t.adjustmentCount,
    dataPoints: [
      ...(scope !== 'EXPENSE' ? [{ label: '总收入', value: 'INCOME' as const, amount: money(income), itemCount: t.incomeCount }] : []),
      ...(scope !== 'INCOME' ? [{ label: '原始支出', value: 'EXPENSE' as const, amount: money(gross), itemCount: t.expenseCount },
        { label: '退款/报销冲减', value: 'ADJUSTMENT' as const, amount: money(adjustment), itemCount: t.adjustmentCount }] : []),
    ] }
}
function addRow(t: Totals, row: Record<string, unknown>): void {
  const amount = fromSqliteInteger(row.amount), count = Number(row.count)
  if (!Number.isSafeInteger(count) || count < 0) throw new LocalError('REPORT_COUNT_OVERFLOW', '账目数量超出支持范围。')
  if (row.entry_type === 'INCOME') {
    t.income += amount
    t.incomeCount += count
  } else if (row.entry_type === 'EXPENSE') {
    t.gross += amount
    t.expenseCount += count
  } else {
    t.adjustment += amount
    t.adjustmentCount += count
  }
}
/** 模拟旧 BigDecimal：先以六位精度求比值，再乘 100 并保留两位，负数同样 HALF_UP。 */
function ratioHalfUp(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n, absolute = numerator < 0n ? -numerator : numerator
  return sign * (absolute / denominator + (absolute % denominator * 2n >= denominator ? 1n : 0n))
}
function unavailable(startDate: string, endDate: string, unavailableReason: string): TimeReport['comparisons'][number]['periodOverPeriod'] {
  return { startDate, endDate, unavailableReason }
}

/** 一次队列读内生成摘要/时间桶/比较；正式写入不可插在这些查询之间，不持久化派生总额。 */
export class ReportQueryService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read'>, private readonly clock = () => new Date()) {}

  async snapshot(filters: ReportFilters, grain?: ReportTimeGrain, signal?: AbortSignal): Promise<CoreReport> {
    const now = this.clock(), scope = filters.scope, ledger = this.ledgerFilters(filters)
    const plan = compileLedgerFilter(ledger, now)
    if (grain !== undefined && !grains.includes(grain)) throw fieldError('grain', '请选择有效的时间粒度。')
    const starts: string[] = [], lastStart = grain ? bucketStart(plan.end, grain) : undefined
    if (grain) {
      for (let day = bucketStart(plan.start, grain); ; day = nextBucket(day, grain)) {
        starts.push(day)
        if (starts.length > 400) throw fieldError('grain', '当前粒度会产生超过 400 个时间点，请缩短日期范围或选择更粗粒度。')
        if (day === lastStart) break
      }
    }
    try {
      return await this.database.read(async sql => {
        throwIfCancelled(signal)
        const totals = await this.totals(sql, ledger, now)
        const result: CoreReport = { resolvedRange: { startDate: plan.start, endDate: plan.end }, summary: summary(totals, scope) }
        if (!grain) return result
        const grouped = await sql.query(`SELECT ${grainSql[grain]} AS bucket_start,entry_type,
          CAST(sum(CAST(amount_text AS INTEGER)) AS TEXT) AS amount,count(*) AS count
          FROM (${readbackProjection}) WHERE ${plan.conditions.join(' AND ')} GROUP BY bucket_start,entry_type ORDER BY bucket_start`, plan.values)
        throwIfCancelled(signal)
        const byStart = new Map<string, Totals>()
        for (const row of grouped) {
          const key = String(row.bucket_start), value = byStart.get(key) ?? empty()
          addRow(value, row)
          byStart.set(key, value)
        }
        const cumulative = empty()
        const buckets: TimeReport['buckets'] = starts.map(day => {
          const t = byStart.get(day) ?? empty()
          for (const key of ['income', 'gross', 'adjustment'] as const) cumulative[key] += t[key]
          const startDate = day < plan.start ? plan.start : day
          const endDate = day === lastStart ? plan.end : addBusinessDays(nextBucket(day, grain), -1)
          const fields = Object.fromEntries(amountFields.map((key, index) => [key, money(amounts(t)[index])])) as Pick<TimeReport['buckets'][number], typeof amountFields[number]>
          const accumulated = amounts(cumulative)
          return { startDate, endDate, label: bucketLabel(startDate, endDate, grain), ...fields,
            cumulativeIncome: money(accumulated[0]), cumulativeGrossExpense: money(accumulated[1]), cumulativeAdjustmentAmount: money(accumulated[2]),
            cumulativeNetExpense: money(accumulated[3]), cumulativeBalance: money(accumulated[4]),
            incomeCount: t.incomeCount, expenseCount: t.expenseCount, adjustmentCount: t.adjustmentCount,
            itemCount: t.incomeCount + t.expenseCount + t.adjustmentCount }
        })
        const meta = (await sql.query('SELECT history_start FROM ledger_meta WHERE singleton=1'))[0]
        let historyStart: string | undefined
        const raw = meta?.history_start
        if (isBusinessDate(raw)) historyStart = raw
        else if (typeof raw === 'string' && isBusinessDate(raw.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw))) historyStart = formatShanghaiBusinessDate(new Date(raw))
        const today = formatShanghaiBusinessDate(now), effectiveEnd = plan.end > today ? today : plan.end
        const current = amounts(totals)
        let periods: [string, string][] = []
        let reason = effectiveEnd < plan.start ? '当前区间尚未开始，无法比较。' : undefined
        if (!reason) {
          try {
            const days = businessDayCount(plan.start, effectiveEnd), previousEnd = addBusinessDays(plan.start, -1)
            const yearStart = previousBusinessYear(plan.start)
            periods = [[addBusinessDays(previousEnd, 1 - days), previousEnd], [yearStart, addBusinessDays(yearStart, days - 1)]]
          } catch { reason = '对比区间超出支持的日期范围。' }
        }
        const compared: TimeReport['comparisons'][number]['periodOverPeriod'][][] = []
        for (const [startDate, endDate] of periods) {
          throwIfCancelled(signal)
          const incomplete = !historyStart ? '账本历史覆盖信息不可用，无法比较。'
            : historyStart > startDate ? '账本可信历史覆盖晚于对比区间开始，对比区间不完整。' : undefined
          if (incomplete) { compared.push(current.map(() => unavailable(startDate, endDate, incomplete))); continue }
          const values = amounts(await this.totals(sql, { ...ledger, range: 'CUSTOM', startDate, endDate }, now))
          compared.push(values.map((value, index) => value === 0n ? unavailable(startDate, endDate, '对比区间金额为 0，无法计算变化率。')
            : { startDate, endDate, amount: money(value), changePercent: money(ratioHalfUp(ratioHalfUp((current[index] - value) * 1_000_000n, value < 0n ? -value : value), 100n)) }))
        }
        throwIfCancelled(signal)
        result.time = { grain, startDate: plan.start, endDate: plan.end, buckets,
          comparisons: metrics.map((metric, index) => ({ metric, currentAmount: money(current[index]),
            periodOverPeriod: reason ? unavailable(plan.start, plan.end, reason) : compared[0][index],
            yearOverYear: reason ? unavailable(plan.start, plan.end, reason) : compared[1][index] })) }
        return result
      }, signal)
    } catch (cause) {
      if (/integer overflow/i.test(String(cause))) throw new LocalError('REPORT_TOTAL_OVERFLOW', '金额合计超出本地聚合支持范围，请缩短日期范围。', { cause })
      throw cause
    }
  }

  private ledgerFilters(filters: ReportFilters): LedgerFilters {
    if (!['ALL', 'EXPENSE', 'INCOME'].includes(filters.scope)) throw fieldError('scope', '请选择有效的账目范围。')
    const compatible = clearIncompatibleReportFilters(filters, filters.scope)
    if (Object.entries(filters).some(([key, value]) => value !== undefined && value !== '' && compatible[key as keyof ReportFilters] === undefined)) {
      throw fieldError('scope', '当前账目范围包含不适用的筛选条件。')
    }
    const { scope, ...rest } = filters
    return { ...rest, type: scope === 'EXPENSE' ? 'EXPENSE_FLOW' : scope === 'INCOME' ? 'INCOME' : 'ALL', lifecycle: 'ACTIVE' }
  }
  private async totals(sql: SqlSession, filters: LedgerFilters, now: Date): Promise<Totals> {
    const plan = compileLedgerFilter(filters, now), result = empty()
    const rows = await sql.query(`SELECT entry_type,CAST(sum(CAST(amount_text AS INTEGER)) AS TEXT) AS amount,count(*) AS count
      FROM (${readbackProjection}) WHERE ${plan.conditions.join(' AND ')} GROUP BY entry_type`, plan.values)
    for (const row of rows) addRow(result, row)
    return result
  }
}
