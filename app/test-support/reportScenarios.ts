import type { LedgerDatabase } from '../src/data/ledgerDatabase'
import type { ReportFilters, ReportTimeGrain } from '../src/api/reports'
import { ReportQueryService } from '../src/data/reports/reportQueryService'
import { AdjustmentService } from '../src/data/entries/adjustmentService'
import { LifecycleService } from '../src/data/entries/lifecycleService'
import { EntryReadbackQuery } from '../src/data/entries/readbackQuery'
import { addBusinessDays } from '../src/domain/businessDates'
import { LocalError } from '../src/domain/localError'
import type { Migration } from '../src/data/migrations'
import { entryFixture } from './entryScenarios'
import { ledgerQueryUpgradeScenario } from './ledgerQueryScenarios'
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const ds = async (db: LedgerDatabase) => String((await db.read(sql => sql.query('SELECT dataset_id FROM ledger_meta')))[0].dataset_id)
const filters: ReportFilters = { query: '', scope: 'ALL', range: 'CUSTOM', startDate: '2026-09-01', endDate: '2026-09-15' }
const grains: ReportTimeGrain[] = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR']

/** 冻结旧 ReportHttpIntegrationTest 的总览、时间和比较基线；金额由正式服务写入，不在页面重算。 */
export async function reportLegacyScenario(db: LedgerDatabase) {
  const f = await entryFixture(db, new Date('2026-09-27T01:00:00Z')), dataset = await ds(db)
  const adjustments = new AdjustmentService(db, () => f.now)
  const add = async (day: string, income: string, expense: string, refund: string, key: string) => {
    const occurredAt = `${day}T01:00:00.000Z`
    await f.service.createIncome({ ...f.income, amount: income, occurredAt }, key + '-i')
    const source = await f.service.createExpense({ ...f.expense, paidAmount: expense, occurredAt }, key + '-e')
    await adjustments.create(dataset, source.id, { adjustmentType: 'REFUND', amount: refund,
      occurredAt: key === 'current' ? '2026-09-08T04:00:00.000Z' : occurredAt }, key + '-a')
    return source
  }
  const source = await add('2026-09-07', '250.00', '100.00', '30.00', 'current')
  await add('2026-08-20', '100.00', '80.00', '10.00', 'previous')
  await add('2025-09-07', '200.00', '90.00', '20.00', 'year')
  const revoked = await adjustments.create(dataset, source.id, { adjustmentType: 'REFUND', amount: '5.00', occurredAt: '2026-09-09T01:00:00.000Z' }, 'revoked')
  await adjustments.revoke(dataset, revoked.id, 1, 'revoke')
  await db.write(sql => sql.run("UPDATE ledger_meta SET history_start='2024-01-01T00:00:00.000Z'"))
  const service = new ReportQueryService(db, () => f.now)
  for (const grain of grains) {
    const { summary, time } = await service.snapshot(filters, grain)
    check(JSON.stringify([summary.totalIncome, summary.grossExpense, summary.adjustmentAmount, summary.netExpense, summary.balance, summary.matchingItemCount]) === JSON.stringify(['250.00', '100.00', '30.00', '70.00', '180.00', 3]), '总览偏离旧固定基线')
    check(time!.buckets.at(-1)!.cumulativeBalance === '180.00', `${grain} 累计失真`)
    const balance = time!.comparisons.find(item => item.metric === 'BALANCE')!
    check(balance.periodOverPeriod.amount === '30.00' && balance.periodOverPeriod.changePercent === '500.00', '环比不等于旧基线')
    check(balance.yearOverYear.amount === '130.00' && balance.yearOverYear.changePercent === '38.46', '同比舍入偏离旧基线')
    if (grain === 'DAY') check(time!.buckets.length === 15 && time!.buckets[0].balance === '0.00' && time!.buckets[6].balance === '150.00' && time!.buckets[7].balance === '30.00', '日桶补零或业务日有误')
  }
  const unfinished = (await service.snapshot({ ...filters, endDate: '2026-10-15' }, 'WEEK')).time!.comparisons[4]
  check(unfinished.periodOverPeriod.startDate === '2026-08-05' && unfinished.periodOverPeriod.endDate === '2026-08-31' && unfinished.yearOverYear.endDate === '2025-09-27', '未结束区间未按同等已过天数比较')
  const scope = await service.snapshot({ ...filters, scope: 'EXPENSE', productId: f.product.id, query: '测试苹果' }, 'DAY')
  check(scope.summary.totalIncome === '0.00' && scope.summary.adjustmentAmount === '30.00' && scope.summary.matchingItemCount === 2, '专属条件或调整来源过滤不一致')
  const ledger = new EntryReadbackQuery(db, () => f.now)
  for (const type of ['INCOME', 'EXPENSE', 'ADJUSTMENT', 'EXPENSE_FLOW', 'ALL'] as const) {
    const page = await ledger.list({ query: '', type, lifecycle: 'ACTIVE', range: filters.range, startDate: filters.startDate, endDate: filters.endDate })
    const expected = type === 'INCOME' || type === 'EXPENSE' || type === 'ADJUSTMENT' ? 1 : type === 'EXPENSE_FLOW' ? 2 : 3
    check(page.items.length === expected, `${type} 下钻不等价`)
  }
  await f.service.updateExpense(source.id, { version: 1, entry: { ...f.expense, paidAmount: '110.00', occurredAt: '2026-09-07T01:00:00.000Z' } }, 'edit')
  const negative = (await service.snapshot({ ...filters, scope: 'EXPENSE' }, 'DAY')).time!.comparisons[4]
  check(negative.currentAmount === '-80.00' && negative.periodOverPeriod.changePercent === '-14.29', '负基期百分比未按绝对分母计算')
  return 'legacy-summary-five-grains-zero-fill-cumulative-comparisons-and-drill-equivalence'
}

export async function reportCalendarScenario(db: LedgerDatabase) {
  const f = await entryFixture(db), service = new ReportQueryService(db, () => f.now)
  for (const [index, occurredAt] of ['2024-02-28T16:00:00.000Z', '2024-03-01T00:00:00.000Z', '2025-12-31T15:59:59.000Z', '2025-12-31T16:00:00.000Z'].entries()) {
    await f.service.createIncome({ ...f.income, amount: '999999999.99', occurredAt }, 'date-' + index)
  }
  const leap = await service.snapshot({ ...filters, startDate: '2024-02-28', endDate: '2024-03-01' }, 'DAY')
  check(leap.time!.buckets.length === 3 && leap.time!.buckets[1].startDate === '2024-02-29' && leap.summary.totalIncome === '1999999999.98', '闰日、跨桥精度或聚合上限错误')
  const years = await service.snapshot({ ...filters, startDate: '2025-12-31', endDate: '2026-01-01' }, 'YEAR')
  check(years.time!.buckets.length === 2 && years.time!.buckets.every(bucket => bucket.totalIncome === '999999999.99'), '跨上海午夜/年归桶错误')
  for (const grain of grains) {
    const time = (await service.snapshot({ ...filters, startDate: '2024-02-29', endDate: '2024-03-01' }, grain)).time!
    check(time.buckets[0].startDate === '2024-02-29' && time.buckets.at(-1)!.endDate === '2024-03-01', `${grain} 首尾未裁剪`)
  }
  await db.write(sql => sql.run("UPDATE ledger_meta SET history_start='2020-01-01T00:00:00.000Z'"))
  const zero = (await service.snapshot(filters, 'DAY')).time!
  check(zero.comparisons.every(item => item.periodOverPeriod.unavailableReason?.includes('为 0')), '零基期伪造百分比')
  await db.write(sql => sql.run("UPDATE ledger_meta SET history_start='2026-09-01T00:00:00.000Z'"))
  check((await service.snapshot(filters, 'DAY')).time!.comparisons.every(item => item.periodOverPeriod.unavailableReason?.includes('不完整')), '历史缺口未保护')
  const future = await service.snapshot({ ...filters, startDate: '2027-01-01', endDate: '2027-01-02' }, 'DAY')
  check(future.time!.comparisons.every(item => item.yearOverYear.unavailableReason?.includes('尚未开始')), '未来区间没有原因')
  await db.write(sql => sql.run("UPDATE ledger_meta SET history_start='2024-02-31T00:00:00Z'"))
  check((await service.snapshot(filters, 'DAY')).time!.comparisons.every(item => item.yearOverYear.unavailableReason?.includes('信息不可用')), '损坏覆盖元信息被误信任')
  check((await service.snapshot({ ...filters, startDate: '9999-12-31', endDate: '9999-12-31' }, 'YEAR')).time!.buckets.length === 1, '最大合法日期越界')
  const start = '2024-01-01'
  check((await service.snapshot({ ...filters, startDate: start, endDate: addBusinessDays(start, 399) }, 'DAY')).time!.buckets.length === 400, '400 桶被误拒绝')
  try { await service.snapshot({ ...filters, startDate: start, endDate: addBusinessDays(start, 400) }, 'DAY'); throw new Error('没有拒绝 401 桶') }
  catch (error) { check(error instanceof LocalError && error.fieldErrors.some(field => field.field === 'grain'), '桶数拒绝未定位粒度') }
  return 'shanghai-midnight-leap-year-clipped-buckets-large-amounts-coverage-zero-future-and-400-bound'
}

export async function reportLifecycleScenario(db: LedgerDatabase) {
  const f = await entryFixture(db), dataset = await ds(db)
  const source = await f.service.createExpense(f.expense, 'source')
  await f.service.createIncome(f.income, 'income')
  const adjustments = new AdjustmentService(db, () => f.now), lifecycle = new LifecycleService(db, () => f.now)
  const refund = await adjustments.create(dataset, source.id, { adjustmentType: 'REFUND', amount: '3.00', occurredAt: f.now.toISOString() }, 'refund')
  const service = new ReportQueryService(db, () => f.now), current: ReportFilters = { query: '', scope: 'ALL', range: 'TODAY' }
  check((await service.snapshot(current)).summary.balance === '988.00', '基础净支出错误')
  await lifecycle.change(dataset, { id: source.id, entryType: 'EXPENSE', version: 1 }, 'trash', 'trash')
  check((await service.snapshot(current)).summary.matchingItemCount === 1, '删除/冻结仍参与报表')
  await lifecycle.change(dataset, { id: source.id, entryType: 'EXPENSE', version: 2 }, 'restore', 'restore')
  check((await service.snapshot(current)).summary.balance === '988.00', '恢复来源未恢复真实结果')
  await adjustments.revoke(dataset, refund.id, 3, 'revoke')
  check((await service.snapshot(current)).summary.balance === '985.00', '撤销仍计入冲减')
  let release!: () => void, entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve }), resume = new Promise<void>(resolve => { release = resolve })
  let paused = false
  const atomic = new ReportQueryService({ read: task => db.read(sql => task({ ...sql, query: async (statement, values) => {
    const rows = await sql.query(statement, values)
    if (!paused && statement.includes('GROUP BY entry_type')) { paused = true; entered(); await resume }
    return rows
  } })) }, () => f.now)
  const snapshot = atomic.snapshot(current, 'DAY')
  await ready
  const write = f.service.createIncome(f.income, 'concurrent-income')
  release()
  const result = await snapshot
  check(result.summary.totalIncome === '1000.00' && result.time!.buckets.at(-1)!.cumulativeIncome === '1000.00', '正式写入插在同一快照之间')
  await write
  check((await service.snapshot(current)).summary.totalIncome === '2000.00', '后续读没有更新')
  return 'lifecycle-invalidations-and-one-queued-read-excludes-concurrent-write'
}
export async function reportUpgradeScenario(manager: (suffix: string, chain?: readonly Migration[]) => LedgerDatabase) {
  await ledgerQueryUpgradeScenario(manager)
  const db = manager('upgrade')
  await db.open()
  try {
    const result = await new ReportQueryService(db, () => new Date('2026-11-17T01:00:00Z')).snapshot({ query: 'ωmega', scope: 'INCOME', range: 'TODAY' }, 'DAY')
    check(result.summary.totalIncome === '205.00' && result.time!.buckets[0].incomeCount === 205, '受控 v6 升级后报表无法消费旧历史快照')
    return 'v6-upgrade-report-consumes-unchanged-money-snapshots-and-metadata'
  } finally { await db.close() }
}

/** 少量受控值验证桥接精度和真实 SQLite 溢出，不冒充九千万条账目的容量验收。 */
export async function reportPrecisionScenario(db: LedgerDatabase) {
  const service = new ReportQueryService({ read: task => db.read(sql => task({ ...sql, query: async () => [
    { entry_type: 'INCOME', amount: '9007199254740993', count: 1 },
  ] })) })
  check((await service.snapshot({ query: '', scope: 'ALL', range: 'TODAY' })).summary.totalIncome === '90071992547409.93', '跨桥文本金额被转换为浮点或单笔上限')
  const overflowing = new ReportQueryService({ read: task => db.read(sql => task({ ...sql, query: () => sql.query(
    'SELECT sum(x) FROM (SELECT 9223372036854775807 AS x UNION ALL SELECT 1)') })) })
  try { await overflowing.snapshot({ query: '', scope: 'ALL', range: 'TODAY' }); throw new Error('未拒绝聚合溢出') }
  catch (error) { check(error instanceof LocalError && error.code === 'REPORT_TOTAL_OVERFLOW' && error.cause, 'SQLite 溢出没有安全原因链') }
  return 'exact-text-over-safe-integer-and-controlled-sqlite-overflow-rejection'
}
