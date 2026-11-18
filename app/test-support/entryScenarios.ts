import { EntryService } from '../src/data/entries/entryService'
import { EntryReadbackQuery } from '../src/data/entries/readbackQuery'
import { DictionaryService } from '../src/data/dictionaries/dictionaryService'
import { ProductService } from '../src/data/dictionaries/productService'
import type { LedgerDatabase } from '../src/data/ledgerDatabase'
import { LocalError } from '../src/domain/localError'
import { migrations, migrationDigest, sha256, type Migration } from '../src/data/migrations'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function rejects(action: () => unknown, code: string, field?: string) {
  try {
    await action()
  } catch (error) {
    check(error instanceof LocalError && error.code === code, `预期 ${code}，实际 ${String(error)}`)
    check(!field || error.fieldErrors.some(item => item.field === field), `未定位字段 ${field}`)
    return
  }
  throw new Error(`未拒绝 ${code}`)
}

export async function entryFixture(database: LedgerDatabase, now = new Date('2026-11-17T01:00:00.000Z')) {
  const dictionaries = new DictionaryService(database)
  const product = await dictionaries.create('product', '测试苹果')
  const category = await dictionaries.create('expense-category', '测试水果')
  const secondary = await dictionaries.create('expense-category', '测试二级', category.id)
  const unit = await dictionaries.create('unit', '斤')
  const funding = await dictionaries.create('funding-channel', '测试现金')
  const payer = await dictionaries.create('payer', '合成公司')
  const incomeCategory = (await dictionaries.list('income-category')).items[0]!
  const expense = { productId: product.id, primaryCategoryId: category.id, secondaryCategoryId: secondary.id,
    unitId: unit.id, unitPrice: '12.3456', quantity: '1.25', paidAmount: '15.00', fundingChannelId: funding.id,
    occurredAt: now.toISOString(), note: '  原始备注  ' }
  const income = { incomeName: '测试工资', payerId: payer.id, incomeCategoryId: incomeCategory.id,
    amount: '1000.00', fundingChannelId: funding.id, occurredAt: now.toISOString() }
  return { dictionaries, product, category, secondary, unit, funding, payer, expense, income,
    service: new EntryService(database, () => now), now }
}

export async function entryWriteScenario(database: LedgerDatabase, observe: (timing: { saveMs: number; reopenReadMs: number }) => void = () => {}) {
  const f = await entryFixture(database)
  const started = performance.now()
  await f.service.createExpense(f.expense, 'expense-one')
  const saveMs = performance.now() - started
  const copies = await Promise.all(Array.from({ length: 3 }, () => f.service.createExpense(f.expense, 'expense-one')))
  check(copies.every(item => item.id === copies[0]!.id), '重复点击产生多笔')
  const saved = copies[0]!
  check(saved.calculatedAmount === '15.43' && saved.paidAmount === '15.00' && saved.note === '原始备注', '精确计算/手动实付/文本错误')
  const equivalent = await f.service.createExpense({ ...f.expense, quantity: '1.250', note: '原始备注' }, 'expense-one')
  check(JSON.stringify(saved) === JSON.stringify(equivalent), '规范化重试未复用原回执')
  await rejects(() => f.service.createExpense({ ...f.expense, paidAmount: '15.01' }, 'expense-one'), 'IDEMPOTENCY_CONFLICT')
  const income = await f.service.createIncome(f.income, 'income-one')
  check(income.incomeName === '测试工资' && income.amount === '1000.00', '收入写入错误')
  await f.dictionaries.rename('product', f.product.id, '新苹果名称')
  check((await f.service.getExpense(saved.id)).productName === '测试苹果', '字典改名覆盖历史快照')
  const updated = await f.service.updateExpense(saved.id, { version: 1, entry: { ...f.expense, unitPrice: '13.0000' } }, 'expense-edit')
  check(updated.version === 2 && updated.paidAmount === '15.00' && updated.calculatedAmount === '16.25', '编辑覆盖实付或版本错误')
  await rejects(() => f.service.updateExpense(saved.id, { version: 1, entry: f.expense }, 'stale'), 'LEDGER_VERSION_CONFLICT')
  check((await f.service.updateExpense(saved.id, { version: 1, entry: { ...f.expense, unitPrice: '13.0000' } }, 'expense-edit')).version === 2, '编辑重试重复推进版本')
  const results = await Promise.allSettled(['a', 'b'].map(key => f.service.updateIncome(income.id, { version: 1, entry: { ...f.income, note: key } }, key)))
  check(results.filter(result => result.status === 'fulfilled').length === 1, '并行旧版本更新未互斥')
  check((await f.service.recentIncomeNames('测试')).items.join() === '测试工资', '收入最近名称错误')
  const recent = (await new ProductService(database).suggestions('新苹果')).items[0]!
  check(recent.lastUnitPrice === '13.0000' && recent.unitId === f.unit.id, '最近商品值未更新')
  // 已提交但调用方丢弃确认：关闭/重开原生连接后以原操作标识重试。
  await database.close()
  const reopening = performance.now()
  await database.open()
  check((await f.service.createExpense(f.expense, 'expense-one')).id === saved.id, '重开后重复插入')
  const readback = await new EntryReadbackQuery(database, () => f.now).list({ query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'TODAY' })
  check(readback.items.length === 2 && readback.items.find(item => item.id === saved.id)?.amount === '15.00', '摘要/明细/库不一致')
  const meta = await database.read(sql => sql.query('SELECT schema_version FROM ledger_meta'))
  check(meta[0]?.schema_version === migrations.length, '重开版本错误')
  observe({ saveMs: Math.round(saveMs), reopenReadMs: Math.round(performance.now() - reopening) })
  return 'exact-writes-version-idempotency-reopen-readback'
}

export async function entryValidationScenario(database: LedgerDatabase) {
  const f = await entryFixture(database)
  for (const [field, value] of [['unitPrice', '1.00001'], ['quantity', '0'], ['quantity', '1000000'], ['paidAmount', '1000000000'],
    ['paidAmount', '-1'], ['paidAmount', '1.001'], ['note', '😀'.repeat(501)], ['occurredAt', '2026-02-30T00:00:00Z'],
    ['occurredAt', new Date(f.now.getTime() + 300_001).toISOString()], ['unitId', f.product.id],
    ['secondaryCategoryId', f.category.id], ['productId', 'missing']] as const) {
    await rejects(() => f.service.createExpense({ ...f.expense, [field]: value }, `invalid-${field}-${crypto.randomUUID()}`), 'VALIDATION_FAILED', field)
  }
  await rejects(() => f.service.createExpense({ ...f.expense, unitPrice: '99999999.9999', quantity: '999999.999' }, 'overflow'), 'VALIDATION_FAILED', 'calculatedAmount')
  for (const [field, value] of [['amount', '0'], ['amount', '1000000000'], ['incomeName', '😀'.repeat(201)], ['incomeName', ' '], ['payerId', f.unit.id]] as const) {
    await rejects(() => f.service.createIncome({ ...f.income, [field]: value }, crypto.randomUUID()), 'VALIDATION_FAILED', field)
  }
  const max = await f.service.createIncome({ ...f.income, incomeName: '😀'.repeat(200), note: '😀'.repeat(500), amount: '999999999.99',
    occurredAt: new Date(f.now.getTime() + 300_000).toISOString() }, 'max')
  check([...max.incomeName].length === 200 && max.amount === '999999999.99', 'Unicode/金额上限被截断')
  await f.dictionaries.changeStatus('unit', f.unit.id, 'INACTIVE')
  await rejects(() => f.service.createExpense(f.expense, 'inactive-unit'), 'VALIDATION_FAILED', 'unitId')
  check((await database.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0]?.n === 1, '无效输入留下半笔记录')
  return 'field-scales-caps-unicode-time-active-reference-validation'
}

export async function entryFailureUndoScenario(database: LedgerDatabase) {
  const f = await entryFixture(database)
  // 在事务最后的回执写入故障，覆盖账目和最近值已经执行后的全量回滚。
  await database.write(sql => sql.run("CREATE TEMP TRIGGER fail_entry_receipt BEFORE INSERT ON idempotency_result BEGIN SELECT RAISE(ABORT,'controlled-disk-full'); END;"))
  let failed = false
  try {
    await f.service.createExpense(f.expense, 'retry-after-failure')
  } catch {
    failed = true
  } finally {
    await database.write(sql => sql.run('DROP TRIGGER temp.fail_entry_receipt'))
  }
  check(failed, '受控存储故障未失败')
  const after = await database.read(sql => sql.query(`SELECT (SELECT count(*) FROM ledger_entry) AS entries,
    (SELECT count(*) FROM idempotency_result) AS receipts,(SELECT count(*) FROM product_details WHERE last_unit_price_scaled IS NOT NULL) AS recents`))
  check(after[0]?.entries === 0 && after[0]?.receipts === 0 && after[0]?.recents === 0, '故障提交部分记录')
  const saved = await f.service.createExpense(f.expense, 'retry-after-failure')
  await rejects(() => f.service.undo('EXPENSE', saved.id, 'wrong-key'), 'EXPENSE_NOT_UNDOABLE')
  await f.service.undo('EXPENSE', saved.id, 'retry-after-failure')
  await f.service.undo('EXPENSE', saved.id, 'retry-after-failure')
  await rejects(() => f.service.createExpense(f.expense, 'retry-after-failure'), 'LEDGER_ENTRY_UNDONE')
  check((await database.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0]?.n === 0, '撤销后原创建重试复活账目')
  check((await new ProductService(database).suggestions('测试')).items[0]?.lastUnitPrice === undefined, '撤销留下最近值')
  const income = await f.service.createIncome(f.income, 'undo-income')
  await f.service.updateIncome(income.id, { version: 1, entry: { ...f.income, note: '修改过' } }, 'edited')
  await rejects(() => f.service.undo('INCOME', income.id, 'undo-income'), 'INCOME_NOT_UNDOABLE')
  return 'late-storage-failure-rollback-retry-and-guarded-undo'
}

/** 旧版只拥有金额与渠道；新版必须保留原值，不补造量价。 */
export async function legacyEntryFixture(database: LedgerDatabase) {
  await database.write(async sql => {
    await sql.run("INSERT INTO dictionary_item(id,kind,name,normalized_name,status) VALUES('legacy-cash','FUNDING_CHANNEL','旧现金','旧现金','ACTIVE')")
    await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date)
      VALUES('legacy-entry','EXPENSE',1500,'legacy-cash','旧现金','2026-11-17T01:00:00.000Z','2026-11-17')`)
    await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
  })
}

/** 回放与当前状态分开判断；新操作仍执行时间/版本校验，旧回执不能冒充当前编辑结果。 */
export async function entryReplayScenario(database: LedgerDatabase) {
  const f = await entryFixture(database)
  let now = f.now
  const service = new EntryService(database, () => now)
  for (const type of ['EXPENSE', 'INCOME'] as const) {
    const create = (amount: string, key: string) => type === 'EXPENSE'
      ? service.createExpense({ ...f.expense, paidAmount: amount }, key)
      : service.createIncome({ ...f.income, amount }, key)
    const update = (id: string, version: number, amount: string, key: string) => type === 'EXPENSE'
      ? service.updateExpense(id, { version, entry: { ...f.expense, paidAmount: amount } }, key)
      : service.updateIncome(id, { version, entry: { ...f.income, amount } }, key)
    now = f.now
    const prefix = type.toLowerCase()
    const created = await create('1000.00', `${prefix}-created`)
    await update(created.id, 1, '1100.00', `${prefix}-first`)
    check((await update(created.id, 1, '1100.00', `${prefix}-first`)).version === 2, '当前编辑回执不能重试')
    await update(created.id, 2, '1200.00', `${prefix}-second`)
    await rejects(() => update(created.id, 1, '1100.00', `${prefix}-first`), 'LEDGER_VERSION_CONFLICT')
    const receipt = await database.read(sql => sql.query('SELECT result_json FROM idempotency_result WHERE operation=? AND operation_id=?',
      [`${prefix}.update`, `${prefix}-first`]))
    check(JSON.parse(String(receipt[0]!.result_json)).version === 2, '过期回放破坏了原回执')
    now = new Date(f.now.getTime() - 3_600_000)
    check((await create('1000.00', `${prefix}-created`)).id === created.id, '回拨后已提交创建被时间校验阻断')
    check((await update(created.id, 2, '1200.00', `${prefix}-second`)).version === 3, '回拨后已提交编辑不能重试')
    await rejects(() => create('1001.00', `${prefix}-created`), 'IDEMPOTENCY_CONFLICT')
    await rejects(() => create('1000.00', `${prefix}-new`), 'VALIDATION_FAILED', 'occurredAt')
    const current = await database.read(sql => sql.query('SELECT CAST(amount_cents AS TEXT) AS amount,row_version FROM ledger_entry WHERE id=?', [created.id]))
    check(current[0]?.amount === '120000' && current[0]?.row_version === 3, '拒绝/回放改变当前金额或版本')
  }
  check((await database.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0]?.n === 2, '回放或新时间拒绝产生额外账目')
  return 'replay-current-version-clock-rollback-and-content-conflict'
}

export async function entrySearchScenario(database: LedgerDatabase) {
  const f = await entryFixture(database)
  const display = 'ＡＰＰＬＥ　Ｃａｆｅ\u0301'
  await f.dictionaries.rename('product', f.product.id, display)
  const saved = await f.service.createExpense(f.expense, 'unicode-search')
  const readback = new EntryReadbackQuery(database, () => f.now)
  const filters = { query: '', type: 'ALL' as const, lifecycle: 'ACTIVE' as const, range: 'TODAY' as const }
  for (const query of [display, 'apple café', 'Ａｐｐｌｅ  CAFE\u0301']) {
    const page = await readback.list({ ...filters, query })
    check(page.items.length === 1 && page.items[0]?.id === saved.id && page.items[0]?.title === display, '快照名称规范化检索不一致')
  }
  await f.dictionaries.rename('product', f.product.id, '后来的商品名称')
  check((await readback.list({ ...filters, query: 'apple' })).items.length === 1, '字典改名破坏快照检索')
  check((await readback.list({ ...filters, query: '后来的' })).items.length === 0, '历史快照被当前字典替代')
  return 'snapshot-search-unicode-normalization-and-historical-name'
}

/** 跨批次回填、数据步骤失败回滚、原摘要兼容和数据步骤篡改拒绝。 */
export async function entrySearchUpgradeScenario(manager: (suffix: string, chain?: readonly Migration[]) => LedgerDatabase) {
  const oldChain = migrations.slice(0, 3)
  const old = manager('search_upgrade', oldChain)
  const current = manager('search_upgrade')
  const data = migrations[3]!.data!
  const failed = manager('search_upgrade', [...oldChain, { ...migrations[3]!, data: { ...data, apply: async sql => {
    await data.apply(sql)
    throw new Error('controlled-search-backfill-failure')
  } } }])
  const tampered = manager('search_upgrade', [...oldChain, { ...migrations[3]!, data: { ...data, source: `${data.source}\nchanged` } }, ...migrations.slice(4)])
  try {
    await old.open()
    const f = await entryFixture(old)
    const dataset = (await old.read(sql => sql.query('SELECT dataset_id FROM ledger_meta')))[0]!.dataset_id
    await old.write(async sql => {
      await sql.run("UPDATE preference SET value='false' WHERE key='theme'")
      for (let index = 0; index < 205; index++) {
        await sql.run(`INSERT INTO ledger_entry(id,entry_type,amount_cents,funding_channel_id,funding_channel_name_snapshot,business_time,business_date,
          product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,
          unit_price_scaled,quantity_scaled,calculated_amount_cents,updated_at)
          VALUES(?,'EXPENSE',1500,?,'旧现金',?,'2026-11-17',?,'ＡＰＰＬＥ',?,'旧水果',?,'斤',123456,1250,1543,?)`,
        [`legacy-${String(index).padStart(3, '0')}`, f.funding.id, f.now.toISOString(), f.product.id, f.category.id, f.unit.id, f.now.toISOString()])
      }
    })
    const history = await old.read(sql => sql.query('SELECT version,digest FROM migration_history ORDER BY version'))
    for (let index = 0; index < oldChain.length; index++) {
      check(history[index]?.digest === await sha256(oldChain[index]!.sql), '旧 SQL 摘要被改变')
    }
    await old.close()
    let refused = false
    try {
      await failed.open()
    } catch {
      refused = true
    }
    check(refused, '回填故障未拒绝升级')
    await old.open()
    check((await old.read(sql => sql.query('PRAGMA table_info(ledger_entry)'))).every(row => row.name !== 'normalized_product_name_snapshot'), '失败 DDL 未回滚')
    check((await old.read(sql => sql.query('SELECT schema_version FROM ledger_meta')))[0]?.schema_version === 3, '失败升级推进版本')
    await old.close()
    await current.open()
    const rows = await current.read(sql => sql.query(`SELECT normalized_product_name_snapshot,product_name_snapshot,row_version,CAST(amount_cents AS TEXT) AS amount
      FROM ledger_entry ORDER BY id`))
    check(rows.length === 205 && rows.every(row => row.normalized_product_name_snapshot === 'apple' && row.product_name_snapshot === 'ＡＰＰＬＥ'
      && row.row_version === 1 && row.amount === '1500'), '跨批次回填缺失或改写了历史数据')
    check((await current.read(sql => sql.query('SELECT dataset_id FROM ledger_meta')))[0]?.dataset_id === dataset, '回填替换数据集')
    check((await current.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0]?.value === 'false', '回填覆盖用户配置')
    check((await current.read(sql => sql.query('SELECT digest FROM migration_history WHERE version=4')))[0]?.digest === await migrationDigest(migrations[3]!), '数据步骤未计入履历摘要')
    await current.close()
    await rejects(() => tampered.open(), 'DATABASE_INCOMPATIBLE')
    await current.open()
    const page = await new EntryReadbackQuery(current, () => f.now).list({ query: 'ＡＰＰＬＥ', type: 'EXPENSE', lifecycle: 'ACTIVE', range: 'TODAY' })
    check(page.items.length === 20 && page.hasMore, '升级后名称检索或分页不可用')
    return 'v3-v4-batched-search-backfill-rollback-and-digest-protection'
  } finally {
    for (const database of [old, current, failed, tampered]) {
      await database.close()
    }
  }
}
