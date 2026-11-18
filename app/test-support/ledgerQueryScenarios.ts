import { EntryReadbackQuery } from '../src/data/entries/readbackQuery'
import { AdjustmentService } from '../src/data/entries/adjustmentService'
import { LifecycleService } from '../src/data/entries/lifecycleService'
import { entryFixture } from './entryScenarios'
import type { LedgerDatabase, SqlSession } from '../src/data/ledgerDatabase'
import type { LedgerFilters } from '../src/api/ledgerEntries'
import { LocalError } from '../src/domain/localError'
import { migrations, type Migration } from '../src/data/migrations'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
async function refused(operation: () => Promise<unknown>, code: string | null = 'VALIDATION_FAILED') {
  try { await operation() } catch (error) {
    check(code === null || error instanceof LocalError && error.code === code, `预期 ${code}，实际 ${String(error)}`)
    return
  }
  throw new Error(`未拒绝 ${code}`)
}
const base: LedgerFilters = { query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'THIS_YEAR' }
const dataset = async (db: LedgerDatabase) => String((await db.read(sql => sql.query('SELECT dataset_id FROM ledger_meta')))[0]!.dataset_id)

/** 共用真实 SQL 场景，覆盖历史快照、字面搜索和类型专属条件；不创建测试专用业务入口。 */
export async function ledgerFilterScenario(db: LedgerDatabase) {
  const f = await entryFixture(db)
  await f.dictionaries.rename('product', f.product.id, 'ＡＰＰＬＥ　Ｃａｆｅ\u0301')
  await f.dictionaries.rename('payer', f.payer.id, '付款公司 ΩMEGA')
  const expense = await f.service.createExpense({ ...f.expense, note: "字面 %_\\' 备注" }, 'query-expense')
  const income = await f.service.createIncome({ ...f.income, incomeName: '年度 奖金', note: '收入专属备注' }, 'query-income')
  const adjustments = new AdjustmentService(db, () => f.now)
  const adjustment = await adjustments.create(await dataset(db), expense.id, {
    adjustmentType: 'REFUND', amount: '1.00', occurredAt: f.now.toISOString(), note: '调整专属备注',
  }, 'query-refund')
  const query = new EntryReadbackQuery(db, () => f.now)
  const ids = async (filters: Partial<LedgerFilters>) => (await query.list({ ...base, ...filters })).items.map(item => item.id)
  for (const word of ['apple café', 'Ａｐｐｌｅ  CAFE\u0301', '测试水果', '测试二级', '测试现金']) {
    check((await ids({ query: word })).includes(expense.id), `未搜索快照 ${word}`)
  }
  check((await ids({ query: 'ωmega' })).join() === income.id, '付款方 Unicode 搜索错误')
  check((await ids({ query: "%_\\'" })).join() === expense.id, '搜索通配符/反斜线/引号未按字面匹配')
  check((await ids({ query: '调整专属' })).join() === adjustment.id, '调整备注未搜索')
  check((await ids({ type: 'ADJUSTMENT', query: '字面' })).length === 0, '调整错误继承来源备注')
  check((await ids({ type: 'INCOME', incomeCategoryId: f.income.incomeCategoryId, payerId: f.payer.id,
    incomeName: '年度 奖金', fundingChannelId: f.funding.id })).join() === income.id, '收入组合条件错误')
  const expenseFilters = { primaryCategoryId: f.category.id, secondaryCategoryId: f.secondary.id, productId: f.product.id,
    unitId: f.unit.id, fundingChannelId: f.funding.id, missingPurchaseChannel: true, missingLocation: true,
    expenseWeekday: 2, expenseTimeBand: 'MORNING' as const }
  check((await ids({ ...expenseFilters, type: 'EXPENSE_FLOW' })).length === 2, '支出构成没有按来源继承维度')
  check((await ids({ ...expenseFilters, type: 'EXPENSE', missingSecondaryCategory: true })).length === 0, '缺失条件未过滤')
  check((await ids({ type: 'EXPENSE', expenseTimeBand: 'EVENING' })).length === 0, '时段未按上海时间过滤')
  for (const invalid of [{ type: 'INCOME', productId: f.product.id }, { type: 'EXPENSE', payerId: f.payer.id },
    { expenseWeekday: 8, type: 'EXPENSE' }, { range: 'CUSTOM', startDate: '2026-02-30', endDate: '2026-03-01' },
    { query: '中'.repeat(201) }] as Partial<LedgerFilters>[]) {
    await refused(() => query.list({ ...base, ...invalid }))
  }
  check((await ids({ query: '中'.repeat(200) })).length === 0, '合法 200 字符搜索被误拒绝')
  await f.dictionaries.rename('product', f.product.id, '后来名称')
  await f.dictionaries.changeStatus('payer', f.payer.id, 'INACTIVE')
  check((await ids({ query: 'apple' })).length === 2 && (await ids({ query: '后来名称' })).length === 0, '当前字典覆盖历史搜索')
  check((await ids({ type: 'INCOME', payerId: f.payer.id })).join() === income.id, '停用历史筛选不可用')
  await f.service.updateExpense(expense.id, { version: 1, entry: { ...f.expense, note: '更新后备注' } }, 'query-edit')
  check((await ids({ query: '更新后' })).join() === expense.id && (await ids({ query: '字面' })).length === 0, '编辑没有原子更新检索键')
  return 'combined-filters-literal-unicode-snapshot-search-and-edit-refresh'
}

/** 首批/增量/并发增删后以数据库顺序回验，不把全部账本加载进页面过滤。 */
export async function ledgerPagingScenario(db: LedgerDatabase) {
  const f = await entryFixture(db)
  for (let index = 0; index < 45; index++) {
    const day = index < 23 ? '2026-11-17' : '2026-11-16'
    await f.service.createIncome({ ...f.income, incomeName: `分页 ${String(index).padStart(2, '0')}`,
      occurredAt: `${day}T01:00:00.000Z` }, `paging-${index}`)
  }
  let maximumRows = 0
  let plan: string[] = []
  const query = new EntryReadbackQuery({ read: task => db.read(sql => task({ ...sql, query: async (statement, values) => {
    const rows = await sql.query(statement, values)
    if (statement.includes('LIMIT 21')) {
      maximumRows = Math.max(maximumRows, rows.length)
      plan = (await sql.query(`EXPLAIN QUERY PLAN ${statement}`, values)).map(row => String(row.detail))
    }
    return rows
  } } as SqlSession)) }, () => f.now)
  const first = await query.list(base)
  check(first.items.length === 20 && first.hasMore && first.nextCursor, '首批不等于 20')
  const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as LedgerFilters
  const second = await query.list(reordered, first.nextCursor)
  const third = await query.list(base, second.nextCursor)
  const all = [...first.items, ...second.items, ...third.items]
  const expected = await db.read(sql => sql.query('SELECT id FROM ledger_entry ORDER BY business_date DESC,business_time DESC,created_at DESC,id DESC'))
  check(all.length === 45 && new Set(all.map(item => item.id)).size === 45 && !third.hasMore, '分页重复或遗漏')
  check(all.map(item => item.id).join() === expected.map(row => row.id).join(), '同时间排序或跨日分组不稳定')
  check(maximumRows <= 21 && plan.some(line => line.includes('ledger_query_')), '查询没有有界结果或日期索引')
  await refused(() => query.list({ ...base, query: '新条件' }, first.nextCursor))
  await refused(() => query.list(base, '%invalid'))
  const currentDataset = await dataset(db)
  await db.write(sql => sql.run("UPDATE ledger_meta SET dataset_id='other'"))
  await refused(() => query.list(base, first.nextCursor))
  await db.write(sql => sql.run('UPDATE ledger_meta SET dataset_id=?', [currentDataset]))
  const added = await f.service.createIncome({ ...f.income, incomeName: '最新插入', occurredAt: '2026-11-17T01:01:00.000Z' }, 'insert-during-pages')
  const lifecycle = new LifecycleService(db, () => f.now)
  const removed = first.items[0]!
  await lifecycle.change(currentDataset, { ...removed, entryType: 'INCOME' }, 'trash', 'query-trash')
  const next = await query.list(base, first.nextCursor)
  check(next.items.every(item => item.id !== added.id && !first.items.some(old => old.id === item.id)), '插入/删除导致旧游标重复')
  const refreshed = await query.list(base)
  check(refreshed.items[0]?.id === added.id && !refreshed.items.some(item => item.id === removed.id), '刷新没有反映增删')
  const trash = await query.list({ ...base, lifecycle: 'TRASHED' })
  check(trash.items.length === 1 && trash.items[0]?.id === removed.id, '回收站过滤错误')
  await lifecycle.change(currentDataset, { id: removed.id, entryType: 'INCOME', version: 2 }, 'restore', 'query-restore')
  check((await query.list({ ...base, entryId: removed.id })).items.length === 1, '恢复后未回读')
  return '20-row-stable-cursor-multiple-dates-insert-delete-restore-and-dataset-binding'
}

/** v6→v7 跨批次回填和故障回滚；旧应用拒绝新结构，历史摘要和业务数据保持。 */
export async function ledgerQueryUpgradeScenario(manager: (suffix: string, chain?: readonly Migration[]) => LedgerDatabase) {
  const old = manager('upgrade', migrations.slice(0, 6))
  const current = manager('upgrade')
  const migration = migrations[6]!
  const failed = manager('upgrade', [...migrations.slice(0, 6), { ...migration, data: { ...migration.data!, apply: async sql => {
    await migration.data!.apply(sql)
    throw new Error('controlled-query-backfill')
  } } }])
  const changed = manager('upgrade', [...migrations.slice(0, 6), { ...migration, data: { ...migration.data!, source: migration.data!.source + 'changed' } }])
  try {
    await old.open()
    const f = await entryFixture(old)
    const ds = await dataset(old)
    await old.write(async sql => {
      await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
      for (let index = 0; index < 205; index++) {
        await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
          income_name,normalized_income_name,payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,note)
          VALUES(?,'INCOME',100,?,'旧现金','2026-11-17T01:00:00.000Z','2026-11-17','ＡＢＣ','abc',?,'旧 ΩMEGA',?,'旧分类','旧备注')`,
        [`old-${String(index).padStart(3, '0')}`, f.funding.id, f.payer.id, f.income.incomeCategoryId])
      }
    })
    await old.close()
    await refused(() => failed.open(), null)
    await old.open()
    check((await old.read(sql => sql.query('SELECT schema_version FROM ledger_meta')))[0]?.schema_version === 6, '失败迁移推进版本')
    check(!(await old.read(sql => sql.query("SELECT name FROM pragma_table_info('ledger_entry') WHERE name='search_text'"))).length, '失败迁移留下新列')
    await old.close()
    await current.open()
    const query = new EntryReadbackQuery(current, () => f.now)
    check((await query.list({ ...base, query: 'ωmega' })).items.length === 20, '跨批回填未消费历史快照')
    check((await current.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry WHERE search_text<>\'\' AND amount_cents=100 AND row_version=1')))[0]?.n === 205, '回填改写金额/版本或漏行')
    check(await dataset(current) === ds && (await current.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0]?.value === '"DARK"', '升级改写数据集或用户偏好')
    await current.close()
    await refused(() => old.open(), 'DATABASE_INCOMPATIBLE')
    await refused(() => changed.open(), 'DATABASE_INCOMPATIBLE')
    await current.open()
    check((await current.read(sql => sql.query('PRAGMA quick_check')))[0]?.quick_check === 'ok', '升级后完整性失败')
    return 'v6-v7-bounded-backfill-rollback-digest-and-old-version-refusal'
  } finally {
    await old.close()
    await failed.close()
    await changed.close()
    await current.close()
  }
}
