import { EntryService } from '../src/data/entries/entryService'
import { EntryReadbackQuery } from '../src/data/entries/readbackQuery'
import { DictionaryService } from '../src/data/dictionaries/dictionaryService'
import { ProductService } from '../src/data/dictionaries/productService'
import type { LedgerDatabase } from '../src/data/ledgerDatabase'
import { LocalError } from '../src/domain/localError'
import { migrations } from '../src/data/migrations'

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
