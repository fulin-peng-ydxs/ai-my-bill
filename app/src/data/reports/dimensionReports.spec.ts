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
import { profileSqliteQueries, type RecordedQuery } from '../../../test-support/sqliteQueryProfile'
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

  /** 批量准备受控账目；同一发生/创建时间刻意把分页压力放在完整 ID 尾游标上。 */
  async function seedQualityHistory(count: number, productCount: number, noise = 0) {
    const f = await entryFixture(db, new Date('2026-11-20T15:00:00Z'))
    const original = await f.service.createExpense({ ...f.expense, unitPrice: '1', quantity: '1', paidAmount: '1.00',
      occurredAt: '2026-11-20T01:00:00.000Z' }, 'history-profile')
    const products = [f.product.id]
    // 此处验证报表扫描，不重复测量字典创建的逐笔唯一性/排序查询和事务开销。
    await db.write(async sql => {
      for (let index = 1; index < productCount; index++) {
        const id = `40000000-0000-0000-0000-${String(index).padStart(12,'0')}`
        const name = `扫描商品${index}`
        await sql.run(`INSERT INTO dictionary_item(id,kind,name,normalized_name,status,sort_order)
          VALUES(?,'PRODUCT',?,?,'ACTIVE',?)`, [id, name, name, index * 10])
        products.push(id)
      }
    })
    const unrelated = noise ? await f.dictionaries.create('product', '无关历史') : undefined
    const columns = await db.read(sql => sql.query('PRAGMA table_info(ledger_entry)'))
    await db.write(async sql => {
      const insert = `INSERT INTO ledger_entry(${columns.map(column => column.name).join(',')}) SELECT ${columns.map(column =>
        ['id','product_id','business_time','business_date','search_text'].includes(String(column.name)) ? '?' : column.name).join(',')}
        FROM ledger_entry WHERE id=?`
      const values = (id: string, product: string, date: string, query: string) => {
        const row: Record<string, string> = { id, product_id: product, business_time: date + 'T01:00:00.000Z',
          business_date: date, search_text: query }
        return columns.filter(column => Object.hasOwn(row, String(column.name))).map(column => row[String(column.name)]!)
      }
      for (let index = 0; index < count; index++)
        await sql.run(insert, [...values(`10000000-0000-0000-0000-${String(index).padStart(12,'0')}`, products[index % productCount]!, '2026-11-20', 'profile-selected'), original.id])
      // 同商品窗外记录，以及窗口内不在候选集合中的商品，均不能放大历史读取工作量。
      for (let index = 0; index < noise; index++) {
        await sql.run(insert, [...values(`20000000-0000-0000-0000-${String(index).padStart(12,'0')}`, f.product.id, '2026-01-01', 'profile-noise'), original.id])
        await sql.run(insert, [...values(`30000000-0000-0000-0000-${String(index).padStart(12,'0')}`, unrelated!.id, '2026-11-20', 'profile-noise'), original.id])
      }
      await sql.run('DELETE FROM ledger_entry WHERE id=?', [original.id])
    })
    return f
  }

  async function qualityHistoryProfile(count: number, productCount: number, noise = 0) {
    const f = await seedQualityHistory(count, productCount, noise)
    const queries: RecordedQuery[] = []
    const nodePlans: string[][] = []
    const observed: Pick<LedgerDatabase, 'read'> = { read: (work, signal) => db.read(sql => work({ ...sql,
      query: async (statement, values = []) => {
        const rows = await sql.query(statement, values)
        if (statement.startsWith('SELECT id,business_time,business_date,created_at,product_id') &&
          statement.includes("entry_type='EXPENSE'") && statement.includes("lifecycle_status='ACTIVE'")) {
          queries.push({ statement, values: [...values], rows: rows.length })
          nodePlans.push((await sql.query('EXPLAIN QUERY PLAN ' + statement, values)).map(row => String(row.detail)))
        }
        return rows
      } }), signal) }
    const report = (await new ReportQueryService(observed, () => f.now).snapshot({ ...dimensionFilters,
      query: 'profile-selected' }, undefined, undefined, 'QUALITY')).expense!
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.every(query => query.rows <= 256)).toBe(true)
    expect(queries.reduce((sum, query) => sum + query.rows, 0)).toBe(count)
    const profile = profileSqliteQueries(state.fixture!.databasePath(db.name), queries)
    expect(profile.rows).toEqual(queries.map(query => query.rows))
    for (const plan of [...nodePlans, ...profile.plans]) {
      const reads = plan.filter(detail => /(?:SEARCH|SCAN) (?:ledger_entry|l)\b/.test(detail))
      expect(reads.length).toBeGreaterThan(0)
      expect(reads.every(detail => detail.startsWith('SEARCH ') && detail.includes('ledger_report_history'))).toBe(true)
      expect(plan.some(detail => /TEMP B-TREE|SUBQUERY/.test(detail))).toBe(false)
    }
    // 保留数值证据；JSON reporter 的 console 捕获不会输出成功用例的日志。
    process.stdout.write('QUALITY_HISTORY_PROFILE ' + JSON.stringify({ count, productCount, noise,
      queries: queries.length, steps: profile.steps, sqliteVersion: profile.sqliteVersion }) + '\n')
    return { profile, report, queries }
  }

  async function freshProfile(count: number, products: number, noise = 0) {
    await db.close()
    db = new LedgerDatabase(`dimension_profile_${++serial}`)
    await db.open()
    return qualityHistoryProfile(count, products, noise)
  }

  it.each([1,129])('质量历史实际查询计划及扫描增长：%i 个商品、同时间 ID 分页', async products => {
    const small = await qualityHistoryProfile(2048, products)
    const large = await freshProfile(4096, products)
    expect(large.profile.steps).toBeLessThan(small.profile.steps * 2.6)
    expect(small.report.points).toHaveLength(100)
    expect(large.report.points).toHaveLength(100)
    expect(large.report.points.every(point => point.warning === '疑似重复线索')).toBe(true)
  })

  it('质量历史实际查询计划及扫描增长：候选商品翻倍不退化为逐商品读取', async () => {
    const small = await qualityHistoryProfile(512,512)
    const large = await freshProfile(1024,1024)
    expect(large.profile.steps).toBeLessThan(small.profile.steps * 2.6)
    expect(small.queries).toHaveLength(4)
    expect(large.queries).toHaveLength(8)
    expect(large.report.points).toEqual([])
  })

  it('质量历史实际查询计划限制窗口与候选商品，噪声历史不扩大读取', async () => {
    const baseline = await qualityHistoryProfile(512,1)
    const noisy = await freshProfile(512,1,4096)
    expect(noisy.profile.steps).toBeLessThan(baseline.profile.steps * 1.1)
    expect(noisy.report.points.map(point => point.value)).toEqual(baseline.report.points.map(point => point.value))
  })

  it('质量历史分页取消后不续发下一批或返回部分线索', async () => {
    const f = await seedQualityHistory(600,129)
    const controller = new AbortController()
    let historyReads = 0
    const observed: Pick<LedgerDatabase, 'read'> = { read: (work, signal) => db.read(sql => work({ ...sql,
      query: async (statement, values) => {
        const rows = await sql.query(statement, values)
        if (statement.startsWith('SELECT id,business_time,business_date,created_at,product_id') &&
          statement.includes("entry_type='EXPENSE'")) {
          historyReads++
          controller.abort()
        }
        return rows
      } }), signal) }
    await expect(new ReportQueryService(observed, () => f.now).snapshot({ query: '', scope: 'EXPENSE', range: 'TODAY' },
      undefined, controller.signal, 'QUALITY')).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(historyReads).toBe(1)
  })

  it('质量历史跨商品批次仍按全局时间过窗，不把已过期低价样本计入中位数', async () => {
    const f = await entryFixture(db, new Date('2026-11-20T15:00:00Z'))
    const products = [f.product.id]
    for (let index = 1; index < 129; index++) products.push((await f.dictionaries.create('product', `时间排序${index}`)).id)
    products.sort()
    const current = Date.parse('2026-11-20T01:00:00.000Z')
    const add = (productId: string, amount: string, time: number, note: string, key: string) => f.service.createExpense({
      ...f.expense, productId, unitPrice: amount, quantity: '1', paidAmount: amount, occurredAt: new Date(time).toISOString(), note }, key)
    // 第一商品在目标之后，第二商品在目标前一天；共享历史范围因此包含目标的过期样本。
    for (let index = 0; index < 128; index++)
      await add(products[index]!, '1.00', current + (index === 1 ? -86400000 : 3600000), '跨组候选', `ordered-${index}`)
    const targetProduct = products.at(-1)!
    for (const [index, days] of [180,100,50].entries())
      await add(targetProduct, String((index + 1) * 10), current - days * 86400000, '历史样本', `ordered-history-${index}`)
    await add(targetProduct, '0.01', current - 180 * 86400000 - 1, '过期历史', 'ordered-expired')
    const target = await add(targetProduct, '27.00', current, '跨组候选', 'ordered-target')
    const report = (await new ReportQueryService(db, () => f.now).snapshot({ ...dimensionFilters,
      query: '跨组候选', startDate: '2026-11-19' }, undefined, undefined, 'QUALITY')).expense!
    expect(report.points.some(point => point.entryId === target.id && point.warning === '异常高价线索')).toBe(false)
  })
})
