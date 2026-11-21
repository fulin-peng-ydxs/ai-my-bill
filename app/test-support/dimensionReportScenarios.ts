import type { ExpenseReportDimension, IncomeReportDimension, ReportFilters } from '../src/api/reports'
import { ReportQueryService } from '../src/data/reports/reportQueryService'
import { EntryReadbackQuery } from '../src/data/entries/readbackQuery'
import type { LedgerDatabase } from '../src/data/ledgerDatabase'
import { migrations, type Migration } from '../src/data/migrations'
import { entryFixture } from './entryScenarios'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
export const dimensionFilters: ReportFilters = { query: '', scope: 'EXPENSE', range: 'CUSTOM', startDate: '2026-11-20', endDate: '2026-11-20' }
export const expenseDimensions: ExpenseReportDimension[] = ['CATEGORY', 'PRODUCT', 'FUNDING_CHANNEL', 'PURCHASE_CHANNEL', 'LOCATION', 'HABIT', 'PRICE', 'FREQUENCY', 'QUALITY']
export const incomeDimensions: IncomeReportDimension[] = ['CATEGORY', 'FUNDING_CHANNEL', 'PAYER', 'NAME', 'FREQUENCY']

/** 冻结现有 Mapper 的量价、分组、收入频次和历史快照口径；同时供原生和 Node SQLite 消费。 */
export async function dimensionBaselineScenario(db: LedgerDatabase) {
  const f = await entryFixture(db, new Date('2026-11-20T15:00:00.000Z'))
  const unit2 = await f.dictionaries.create('unit', '箱')
  const purchase = await f.dictionaries.create('purchase-channel', '未指定')
  const location = await f.dictionaries.create('location', '未指定')
  const payer2 = await f.dictionaries.create('payer', '第二付款方')
  const funding2 = await f.dictionaries.create('funding-channel', '另一渠道')
  const category2 = await f.dictionaries.create('income-category', '奖金类')
  const a = await f.service.createExpense({ ...f.expense, quantity: '2', unitPrice: '40', paidAmount: '100.00', occurredAt: '2026-11-20T01:00:00.000Z', secondaryCategoryId: undefined }, 'dim-a')
  const b = await f.service.createExpense({ ...f.expense, quantity: '3', unitPrice: '30', paidAmount: '60.00',
    purchaseChannelId: purchase.id, locationLabelId: location.id, occurredAt: '2026-11-20T02:00:00Z' }, 'dim-b')
  await f.service.createExpense({ ...f.expense, quantity: '4', unitPrice: '20', paidAmount: '40.00', unitId: unit2.id,
    secondaryCategoryId: undefined, occurredAt: '2026-11-20T03:00:00Z' }, 'dim-c')
  const unused = await f.dictionaries.create('product', '长期未购旧米')
  const historical = await f.service.createExpense({ ...f.expense, productId: unused.id, paidAmount: '80.00', occurredAt: '2026-10-01T01:00:00Z' }, 'dim-old')
  await f.service.createIncome({ ...f.income, incomeName: '工资', amount: '250.00' }, 'dim-income-a')
  await f.service.createIncome({ ...f.income, incomeName: '奖金', amount: '50.00', payerId: payer2.id,
    incomeCategoryId: category2.id, fundingChannelId: funding2.id }, 'dim-income-b')
  const query = new ReportQueryService(db, () => f.now)
  for (const dimension of expenseDimensions) {
    const result = await query.snapshot(dimensionFilters, undefined, undefined, dimension)
    check(result.summary.grossExpense === '200.00' && result.resolvedRange.startDate === '2026-11-20', `${dimension} 不是同一快照`)
    check(result.expense?.dimension === dimension && !result.expense.truncated, `${dimension} 未接通`)
  }
  const product = (await query.snapshot(dimensionFilters, undefined, undefined, 'PRODUCT')).expense!
  check(product.points.length === 2, '不同单位被合并')
  const main = product.points.find(p => p.value === `${f.product.id}|${f.unit.id}`)!
  check(main.amount === '160.00' && main.sharePercent === '80.00'
    && main.detail === '数量 5 斤 · 平均填写单价 35.00 · 最近 30.00', '商品数量/实付/填写单价错误')
  const price = (await query.snapshot(dimensionFilters, undefined, undefined, 'PRICE')).expense!
  check(price.points.find(p => p.value === main.value)?.detail === '最低 30.00 · 最高 40.00 · 最近 30.00 · 平均实际单位成本 35.00', '实际成本与填写单价混淆')
  for (const dimension of ['PURCHASE_CHANNEL', 'LOCATION'] as const) {
    const points = (await query.snapshot(dimensionFilters, undefined, undefined, dimension)).expense!.points
    check(points.length === 2 && points.find(p => p.value === 'UNSPECIFIED')?.amount === '140.00'
      && points.find(p => p.value !== 'UNSPECIFIED')?.amount === '60.00', `${dimension} 空值与同名用户字典混淆`)
  }
  const category = (await query.snapshot({ ...dimensionFilters, primaryCategoryId: f.category.id }, undefined, undefined, 'CATEGORY')).expense!
  check(category.points.find(p => p.value === 'UNSPECIFIED')?.amount === '140.00' && category.points.find(p => p.value === f.secondary.id)?.amount === '60.00', '二级空分类错误')
  const habit = (await query.snapshot(dimensionFilters, undefined, undefined, 'HABIT')).expense!
  check(habit.points.find(p => p.value === 'WEEKDAY:5')?.amount === '200.00'
    && habit.points.find(p => p.value === 'AVERAGE:ENTRY')?.amount === '66.67', '上海星期/均值舍入错误')
  const frequency = (await query.snapshot(dimensionFilters, undefined, undefined, 'FREQUENCY')).expense!
  check(frequency.points.find(p => p.value === f.product.id)?.amount === '3.00', '消费频次不是条数')
  const old = frequency.points.find(p => p.value === unused.id)!
  check(old.entryId === historical.id && old.drillStartDate === '2026-10-01' && old.drillEndDate === '2026-10-01', '长期未购不能返回最近历史记录')
  const ledger = new EntryReadbackQuery(db, () => f.now)
  const { scope: _, ...drillBase } = dimensionFilters
  const drill = await ledger.list({ ...drillBase, type: 'EXPENSE', lifecycle: 'ACTIVE', productId: f.product.id, unitId: f.unit.id })
  check(drill.items.map(p => p.id).sort().join() === [a.id, b.id].sort().join(), '商品+单位下钻组成不正确')
  for (const dimension of incomeDimensions) {
    const result = await query.snapshot({ ...dimensionFilters, scope: 'INCOME' }, undefined, undefined, dimension)
    check(result.summary.totalIncome === '300.00' && result.income?.points.length === 2, `收入 ${dimension} 缺失`)
    const top = result.income.points.find(p => p.value === (dimension === 'NAME' || dimension === 'FREQUENCY' ? '工资'
      : dimension === 'CATEGORY' ? f.income.incomeCategoryId : dimension === 'FUNDING_CHANNEL' ? f.funding.id : f.payer.id))!
    check(top.amount === (dimension === 'FREQUENCY' ? '1.00' : '250.00'), `收入 ${dimension} 口径错误`)
  }
  await f.dictionaries.rename('product', f.product.id, '当前新名字')
  check((await query.snapshot(dimensionFilters, undefined, undefined, 'PRODUCT')).expense!.points.every(p => !p.label.includes('当前新名字')), '字典改名污染历史标签')
  return 'nine-expense-five-income-exact-price-unit-empty-groups-frequency-and-drill'
}

/** 180 天含下界、严格早于当前时刻，3 样本、精确 50% 和 10 分钟含下界。 */
export async function dimensionQualityScenario(db: LedgerDatabase) {
  const f = await entryFixture(db, new Date('2026-11-20T15:00:00.000Z'))
  const add = (paidAmount: string, occurredAt: string, key: string, productId = f.product.id) => f.service.createExpense({ ...f.expense,
    productId, unitPrice: paidAmount, quantity: '1', paidAmount, occurredAt }, key)
  const current = new Date('2026-11-20T01:00:00.000Z')
  for (const [i, days] of [180, 100, 50].entries())
    await add('10.00', new Date(current.getTime() - days * 86400000).toISOString(), `quality-history-${i}`)
  await add('0.01', new Date(current.getTime() - 180 * 86400000 - 1).toISOString(), 'quality-too-old')
  const equal = await add('15.00', current.toISOString(), 'quality-equal')
  const high = await add('15.01', current.toISOString(), 'quality-high')
  const duplicateProduct = await f.dictionaries.create('product', '重复测试商品')
  await add('7.00', '2026-11-20T02:00:00.000Z', 'duplicate-first', duplicateProduct.id)
  const nine = await add('7.00', '2026-11-20T02:09:00.000Z', 'duplicate-nine', duplicateProduct.id)
  const eleven = await add('7.00', '2026-11-20T02:20:00.000Z', 'duplicate-eleven', duplicateProduct.id)
  const ten = await add('7.00', '2026-11-20T02:30:00.000Z', 'duplicate-ten', duplicateProduct.id)
  const over = await add('7.00', '2026-11-20T02:40:00.001Z', 'duplicate-over', duplicateProduct.id)
  // 无效原支出不能成为候选或中位数样本；合成库准备不触及正式用户数据。
  const trashed = await add('0.01', '2026-11-19T01:00:00.000Z', 'quality-trashed')
  await db.write(sql => sql.run("UPDATE ledger_entry SET lifecycle_status='TRASHED',deleted_at=?,purge_after=? WHERE id=?", [f.now.toISOString(),'2026-12-20T15:00:00.000Z',trashed.id]))
  const before = await db.read(sql => sql.query('SELECT * FROM ledger_entry ORDER BY id'))
  const report = (await new ReportQueryService(db, () => f.now).snapshot(dimensionFilters, undefined, undefined, 'QUALITY')).expense!
  const has = (id: string, warning: string) => report.points.some(p => p.entryId === id && p.warning === warning)
  check(!has(equal.id, '异常高价线索') && has(high.id, '异常高价线索'), '50% 临界被舍入或使用同时间样本')
  check(has(nine.id, '疑似重复线索') && !has(eleven.id, '疑似重复线索') && has(ten.id, '疑似重复线索') && !has(over.id, '疑似重复线索'), '9/10/11 分钟边界错误')
  check(report.qualityRule?.version === 'expense-quality-v1' && report.points.every(p => p.entryId !== trashed.id), '规则版本或有效状态错误')
  check(JSON.stringify(before) === JSON.stringify(await db.read(sql => sql.query('SELECT * FROM ledger_entry ORDER BY id'))), '质量分析改写账目')
  return 'quality-v1-exact-median-180-days-three-samples-50-percent-and-10-minute-boundaries-readonly'
}

export async function dimensionUpgradeScenario(factory: (name: string, chain?: readonly Migration[]) => LedgerDatabase) {
  const old = factory('v7', migrations.slice(0, 7))
  await old.open()
  const f = await entryFixture(old)
  await f.service.createExpense(f.expense, 'before-report-upgrade')
  const partial = await f.service.createExpense({ ...f.expense, occurredAt: new Date(f.now.getTime() + 60000).toISOString() }, 'before-report-partial')
  // v3 明确保留旧版 NULL 量价；新报表不能回填或将它解释为零。
  await old.write(sql => sql.run('UPDATE ledger_entry SET unit_price_scaled=NULL,quantity_scaled=NULL,calculated_amount_cents=NULL WHERE id=?', [partial.id]))
  const before = await old.read(sql => sql.query('SELECT * FROM ledger_entry ORDER BY id'))
  await old.close()
  const upgraded = factory('v7')
  await upgraded.open()
  const after = await upgraded.read(sql => sql.query('SELECT * FROM ledger_entry ORDER BY id'))
  check(JSON.stringify(before) === JSON.stringify(after), '索引升级改写账目')
  const report = await new ReportQueryService(upgraded, () => f.now).snapshot({ query: '', scope: 'EXPENSE', range: 'TODAY' }, undefined, undefined, 'PRODUCT')
  check(report.expense!.points[0]!.amount === '30.00'
    && report.expense!.points[0]!.detail?.includes('数量 资料不足')
    && report.expense!.points[0]!.detail?.includes('最近 资料不足'), 'v7 升级后缺失量价被臆造或账目不兼容')
  const plan = await upgraded.read(sql => sql.query(`EXPLAIN QUERY PLAN SELECT id FROM ledger_entry
    WHERE entry_type='EXPENSE' AND lifecycle_status='ACTIVE' AND product_id=? AND business_time BETWEEN ? AND ?`, [f.product.id, '2026-01-01', '2026-12-31']))
  check(plan.some(row => String(row.detail).includes('ledger_report_history')), '历史范围未使用新增组合索引')
  await upgraded.close()
  return 'v7-to-v8-append-only-index-upgrade-preserves-ledger-and-history-query-plan'
}
