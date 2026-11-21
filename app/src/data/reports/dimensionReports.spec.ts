import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createSqliteBridge } from '../../../test-support/sqliteBridge'
const state = vi.hoisted(() => ({ fixture: undefined as ReturnType<typeof createSqliteBridge> | undefined }))
vi.mock('@capacitor/core', async () => {
  const { createSqliteBridge } = await import('../../../test-support/sqliteBridge')
  const fixture = createSqliteBridge()
  state.fixture = fixture
  return { Capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true },
    registerPlugin: (name: string) => name === 'CapacitorSQLite' ? fixture.sqlite : fixture.files }
})
import { LedgerDatabase } from '../ledgerDatabase'
import { ReportQueryService } from './reportQueryService'
import { CostMedian, ExactMean, fraction } from './reportMath'
import { dimensionBaselineScenario, dimensionQualityScenario, dimensionUpgradeScenario, dimensionFilters, expenseDimensions, incomeDimensions } from '../../../test-support/dimensionReportScenarios'
import { entryFixture } from '../../../test-support/entryScenarios'
let db: LedgerDatabase, serial = 0
beforeEach(async () => {
  db = new LedgerDatabase(`dimension_${++serial}`)
  await db.open()
})
afterEach(() => db.close())
afterAll(() => state.fixture!.dispose())
describe('T11 多维原生查询', () => {
  it('九类支出、五类收入、量价单位、未指定分组、历史快照和下钻基线', () => dimensionBaselineScenario(db))
  it('180 天/3 样本/50%/10 分钟与有效状态精确边界，线索不修改账目', () => dimensionQualityScenario(db))
  it('v7 仅追加索引升级至 v8，保持账目、用户配置和报表', () => dimensionUpgradeScenario((name, chain) => new LedgerDatabase(`dim_upgrade_${serial}_${name}`, chain)))
  it('有理数均值和奇偶滑窗中位数精确，不受二进制浮点影响', () => {
    const mean = new ExactMean()
    mean.add(fraction(1n, 3n))
    mean.add(fraction(2n, 3n))
    expect(mean.cents()).toBe(50n)
    const median = new CostMedian([fraction(1n, 3n), fraction(2n, 3n), fraction(5n, 3n)])
    median.update(fraction(1n, 3n), 1)
    median.update(fraction(2n, 3n), 1)
    expect(median.median()).toEqual(fraction(1n, 2n))
    median.update(fraction(5n, 3n), 1)
    expect(median.median()).toEqual(fraction(2n, 3n))
    median.update(fraction(1n, 3n), -1)
    expect(median.median()).toEqual(fraction(7n, 6n))
  })
  it('无数据逐维返回空态，排行 50/质量 100 项截断，跨 256 条批次仍无逐笔历史查询', async () => {
    const f = await entryFixture(db, new Date('2026-11-20T15:00:00.000Z'))
    const query = new ReportQueryService(db, () => f.now)
    for (const [scope, dimensions] of [['EXPENSE', expenseDimensions], ['INCOME', incomeDimensions]] as const)
      for (const dimension of dimensions) {
        const result = await query.snapshot({ ...dimensionFilters, scope }, undefined, undefined, dimension)
        expect(result.expense?.points ?? result.income?.points).toEqual([])
      }
    for (let index = 0; index < 51; index++)
      await f.service.createIncome({ ...f.income, incomeName: `分组${String(index).padStart(2, '0')}`, amount: '1.00' }, `rank-${index}`)
    const income = (await query.snapshot({ ...dimensionFilters, scope: 'INCOME' }, undefined, undefined, 'NAME')).income!
    expect(income.points).toHaveLength(50)
    expect(income.truncated).toBe(true)
    expect(income.points[0]!.label).toBe('分组00')
    for (let index = 0; index < 300; index++)
      await f.service.createExpense({ ...f.expense, unitPrice: '1', quantity: '1', paidAmount: '1.00',
        occurredAt: new Date(Date.parse('2026-11-20T01:00:00Z') + index * 1000).toISOString() }, `quality-limit-${index}`)
    let reads = 0
    const observed: Pick<LedgerDatabase, 'read'> = { read: (work, signal) => db.read(sql => work({ ...sql,
      query: async (statement, values) => { reads++; return sql.query(statement, values) } }), signal) }
    const quality = (await new ReportQueryService(observed, () => f.now).snapshot(dimensionFilters, undefined, undefined, 'QUALITY')).expense!
    expect(quality.points).toHaveLength(100)
    expect(quality.truncated).toBe(true)
    expect(quality.points.every(point => point.warning === '疑似重复线索')).toBe(true)
    expect(reads).toBeLessThanOrEqual(6)
  })
  it('跨午夜只取一次时钟，维度/摘要同一队列读，取消与错误范围明确拒绝', async () => {
    const f = await entryFixture(db, new Date('2026-11-20T15:59:59Z'))
    await f.service.createExpense(f.expense, 'midnight-dim')
    let now = f.now
    const clock = vi.fn(() => now), query = new ReportQueryService(db, clock)
    const pending = query.snapshot({ query: '', scope: 'EXPENSE', range: 'TODAY' }, undefined, undefined, 'CATEGORY')
    now = new Date('2026-11-20T16:00:01Z')
    const result = await pending
    expect(clock).toHaveBeenCalledTimes(1)
    expect(result.resolvedRange.endDate).toBe('2026-11-20')
    expect(result.summary.grossExpense).toBe(result.expense!.points[0]!.amount)
    await expect(query.snapshot({ query: '', scope: 'INCOME', range: 'TODAY' }, undefined, undefined, 'QUALITY')).rejects.toMatchObject({fieldErrors: [{field: 'dimension'}]})
    const controller = new AbortController()
    controller.abort()
    await expect(query.snapshot({ query: '', scope: 'EXPENSE', range: 'TODAY' }, undefined, controller.signal, 'QUALITY')).rejects.toMatchObject({code: 'OPERATION_CANCELLED'})
  })
  it('旧版缺失维度字段不会生成 undefined 分组或假下钻，仍可查看总览', async () => {
    const f = await entryFixture(db)
    const income = await f.service.createIncome(f.income, 'old-partial-income')
    await db.write(sql => sql.run('UPDATE ledger_entry SET income_name=NULL WHERE id=?', [income.id]))
    const query = new ReportQueryService(db, () => f.now)
    const filters = { query: '', scope: 'INCOME' as const, range: 'TODAY' as const }
    await expect(query.snapshot(filters, undefined, undefined, 'NAME')).rejects.toMatchObject({ code: 'REPORT_ENTRY_INCOMPATIBLE' })
    expect((await query.snapshot(filters)).summary.totalIncome).toBe('1000.00')
  })
  it('少于三条历史不提示高价，偶数中位数与非终止复购间隔保留精确十进制', async () => {
    const f = await entryFixture(db, new Date('2026-11-20T15:00:00Z'))
    const sparse = await f.dictionaries.create('product', '两条历史')
    const even = await f.dictionaries.create('product', '偶数历史')
    const add = (productId: string, day: string, paidAmount: string, key: string) => f.service.createExpense({ ...f.expense,
      productId, quantity: '1', unitPrice: paidAmount, paidAmount, occurredAt: day + 'T01:00:00.000Z' }, key)
    for (const [i, day] of ['2026-11-18','2026-11-19'].entries()) await add(sparse.id, day, '10.00', `two-${i}`)
    const tooFew = await add(sparse.id, '2026-11-20', '16.00', 'two-current')
    for (const [i, paid] of ['10.00','10.00','20.00','20.00'].entries()) await add(even.id, `2026-11-${16+i}`, paid, `even-${i}`)
    const equal = await add(even.id, '2026-11-20', '22.50', 'even-equal')
    const high = await add(even.id, '2026-11-20', '22.51', 'even-high')
    const query = new ReportQueryService(db, () => f.now)
    const quality = (await query.snapshot(dimensionFilters, undefined, undefined, 'QUALITY')).expense!
    const highIds = quality.points.filter(p => p.warning === '异常高价线索').map(p => p.entryId)
    expect(highIds).not.toContain(tooFew.id)
    expect(highIds).not.toContain(equal.id)
    expect(highIds).toContain(high.id)
    for (const [i, at] of ['2026-11-18T01:00:00Z','2026-11-18T02:00:00Z','2026-11-19T01:00:00Z','2026-11-20T01:00:00Z'].entries())
      await f.service.createExpense({ ...f.expense, occurredAt: at }, `interval-${i}`)
    const frequency = (await query.snapshot({ ...dimensionFilters, startDate: '2026-11-18' }, undefined, undefined, 'FREQUENCY')).expense!
    expect(frequency.points.find(p => p.value === f.product.id)?.detail).toContain('平均复购间隔 0.66666666666666666667 天')
  })
  it('价格排行保留未舍入均值，批次顺序使用既有索引而非逐批全表排序', async () => {
    const f = await entryFixture(db)
    const a = await f.dictionaries.create('product', 'A低价')
    const z = await f.dictionaries.create('product', 'Z高价')
    await f.service.createExpense({ ...f.expense, productId: a.id, unitPrice: '12.3455' }, 'rank-low')
    await f.service.createExpense({ ...f.expense, productId: z.id, unitPrice: '12.3456' }, 'rank-high')
    const result = await new ReportQueryService(db, () => f.now).snapshot({ query: '', scope: 'EXPENSE', range: 'TODAY' }, undefined, undefined, 'PRICE')
    expect(result.expense!.points.map(p => p.amount)).toEqual(['12.35','12.35'])
    expect(result.expense!.points[0]!.label).toContain('Z高价')
    const plan = await db.read(sql => sql.query(`EXPLAIN QUERY PLAN SELECT id FROM ledger_entry WHERE lifecycle_status='ACTIVE'
      AND entry_type='EXPENSE' AND business_date BETWEEN ? AND ? AND (business_date,business_time,created_at,id)>(?,?,?,?)
      ORDER BY business_date,business_time,created_at,id LIMIT 256`, ['2026-01-01','2026-12-31','2026-01-01','','','']))
    expect(plan.some(p => String(p.detail).includes('ledger_query_type'))).toBe(true)
    expect(plan.some(p => String(p.detail).includes('TEMP B-TREE'))).toBe(false)
    await db.write(sql => sql.run('UPDATE ledger_entry SET unit_price_scaled=NULL'))
    const missing = await new ReportQueryService(db, () => f.now).snapshot({ query: '', scope: 'EXPENSE', range: 'TODAY' }, undefined, undefined, 'PRICE')
    expect(missing.expense!.points).toEqual([])
    expect(missing.summary.grossExpense).toBe('30.00')
  })
})
