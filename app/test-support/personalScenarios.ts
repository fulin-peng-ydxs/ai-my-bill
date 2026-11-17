import { DraftService } from '../src/data/personal/draftService'
import { PreferenceService } from '../src/data/personal/preferenceService'
import { TemplateService } from '../src/data/personal/templateService'
import type { LedgerDatabase } from '../src/data/ledgerDatabase'
import { migrations, type Migration } from '../src/data/migrations'
import { DEFAULT_PREFERENCES } from '../src/domain/preferences'
import { DRAFT_TTL_MS } from '../src/domain/ledgerDraft'
import { LocalError } from '../src/domain/localError'
import { ProductService } from '../src/data/dictionaries/productService'
import { entryFixture } from './entryScenarios'

function check(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message)
  }
}
async function refused(action: () => Promise<unknown>, code?: string) {
  try {
    await action()
  } catch (error) {
    check(!code || error instanceof LocalError && error.code === code, `预期 ${code}，实际 ${String(error)}`)
    return
  }
  throw new Error('应拒绝却成功')
}
export const datasetId = (database: LedgerDatabase) => database.read(async sql => String((await sql.query('SELECT dataset_id FROM ledger_meta'))[0]!.dataset_id))

export async function personalDraftScenario(database: LedgerDatabase) {
  const id = await datasetId(database)
  let now = Date.parse('2026-11-17T01:00:00.000Z')
  const drafts = new DraftService(database, () => now)
  await drafts.save(id, 'EXPENSE', { unitPrice: '12.', paidAmount: '0', note: '支出😀' })
  await drafts.save(id, 'INCOME', { incomeName: '未提交工资', amount: '100' })
  await database.close()
  await database.open()
  check((await drafts.read(id, 'EXPENSE')).unitPrice === '12.', '不完整小数未恢复')
  check((await drafts.read(id, 'INCOME')).incomeName === '未提交工资', '两种草稿串写')
  await refused(() => drafts.save(id, 'EXPENSE', { note: '😀'.repeat(501) }), 'DRAFT_INVALID')
  await database.write(sql => sql.run("CREATE TEMP TRIGGER fail_draft BEFORE UPDATE ON ledger_draft BEGIN SELECT RAISE(ABORT,'controlled-draft-full'); END"))
  await refused(() => drafts.save(id, 'EXPENSE', { note: '失败' }))
  await database.write(sql => sql.run('DROP TRIGGER temp.fail_draft'))
  check((await drafts.read(id, 'EXPENSE')).note === '支出😀', '失败覆盖了已保存草稿')
  await drafts.save(id, 'EXPENSE', { note: '重试' })
  check((await drafts.read(id, 'EXPENSE')).note === '重试', '原内容无法重试')
  now += DRAFT_TTL_MS
  check(Object.keys(await drafts.read(id, 'INCOME')).length === 0, '过期草稿仍恢复')
  await database.write(sql => sql.run("UPDATE ledger_draft SET schema_version=99 WHERE entry_type='EXPENSE'"))
  await refused(() => drafts.read(id, 'EXPENSE'), 'DRAFT_INVALID')
  check((await database.read(sql => sql.query('SELECT count(*) AS n FROM ledger_draft')))[0]?.n === 2, '非法旧值被破坏性删除')
  await database.write(sql => sql.run("UPDATE ledger_draft SET schema_version=1,data_json=? WHERE entry_type='EXPENSE'", [JSON.stringify({ unexpected: 'x'.repeat(17000) })]))
  await refused(() => drafts.read(id, 'EXPENSE'), 'DRAFT_INVALID')
  const f = await entryFixture(database)
  await f.service.createExpense(f.expense, 'consume-expense-draft')
  check((await database.read(sql => sql.query('SELECT entry_type FROM ledger_draft')))[0]?.entry_type === 'INCOME', '保存支出清除了收入草稿或没有消费支出草稿')
  await database.write(sql => sql.run("CREATE TEMP TRIGGER fail_personal_receipt BEFORE INSERT ON idempotency_result BEGIN SELECT RAISE(ABORT,'controlled-receipt-failure'); END"))
  await refused(() => f.service.createIncome(f.income, 'consume-income-draft'))
  await database.write(sql => sql.run('DROP TRIGGER temp.fail_personal_receipt'))
  check((await database.read(sql => sql.query('SELECT entry_type FROM ledger_draft')))[0]?.entry_type === 'INCOME', '账目失败没有回滚草稿消费')
  await f.service.createIncome(f.income, 'consume-income-draft')
  check((await database.read(sql => sql.query('SELECT count(*) AS n FROM ledger_draft')))[0]?.n === 0, '成功保存没有消费对应草稿')
  return 'dual-drafts-reopen-ttl-storage-retry-and-atomic-entry-consumption'
}

export async function personalPreferenceScenario(database: LedgerDatabase) {
  const id = await datasetId(database)
  const f = await entryFixture(database)
  const service = new PreferenceService(database)
  await service.save(id, { themeMode: 'DARK', ledgerDefaultRange: 'THIS_WEEK', reportDefaultRange: 'LAST_MONTH', recentEntryType: 'INCOME', defaultFundingChannelId: f.funding.id })
  await database.close()
  await database.open()
  const value = await service.read(id)
  check(value.ledgerDefaultRange === 'THIS_WEEK' && value.reportDefaultRange === 'LAST_MONTH', '范围偏好键映射或持久化错误')
  check(value.themeMode === 'DARK' && value.recentEntryType === 'INCOME' && value.defaultFundingChannelName === '测试现金', '偏好保存/读取/引用消费错误')
  await f.dictionaries.changeStatus('funding-channel', f.funding.id, 'INACTIVE')
  check((await service.read(id)).defaultFundingChannelId === null, '停用引用未安全回退')
  await f.dictionaries.changeStatus('funding-channel', f.funding.id, 'ACTIVE')
  check((await service.read(id)).defaultFundingChannelId === f.funding.id, '回退改写了合法用户值')
  await refused(() => service.save(id, { themeMode: 'INVALID' as 'DARK' }), 'VALIDATION_FAILED')
  await database.write(sql => sql.run("INSERT INTO preference VALUES('future_flag','false')"))
  await service.reset(id)
  const reset = await service.read(id)
  for (const [key, expected] of Object.entries(DEFAULT_PREFERENCES)) {
    check(reset[key as keyof typeof reset] === expected, '恢复默认缺少字段 ' + key)
  }
  check((await database.read(sql => sql.query("SELECT value FROM preference WHERE key='future_flag'")))[0]?.value === 'false', '重置扩大到未知设置')
  return 'preferences-persist-consume-reset-and-inactive-reference-fallback'
}

export async function personalTemplateScenario(database: LedgerDatabase) {
  const id = await datasetId(database)
  const f = await entryFixture(database)
  const templates = new TemplateService(database, () => f.now)
  const expense = await f.service.createExpense(f.expense, 'template-expense')
  const income = await f.service.createIncome(f.income, 'template-income')
  const e = await templates.upsert(id, expense.id)
  const i = await templates.upsert(id, income.id)
  check((await templates.upsert(id, income.id)).id === i.id, '同名收入没有更新原模板')
  await f.service.updateExpense(expense.id, { version: 1, entry: { ...f.expense, paidAmount: '16.00' } }, 'template-edit')
  check((await templates.upsert(id, expense.id)).id === e.id, '同键产生重复模板')
  check((await templates.list(id, 'EXPENSE')).items.length === 1, '模板唯一键失效')
  const selected = await templates.select(id, e.id)
  check(selected.paidAmount === '16.00' && selected.unitPrice === '12.3456' && selected.quantity === '1.250', '模板量价被浮点转换')
  check(!('note' in selected) && !('occurredAt' in selected) && !('lifecycleStatus' in selected), '模板越过回填白名单')
  const target = await f.dictionaries.create('product', '合并后苹果')
  await new ProductService(database).merge(f.product.id, target.id)
  check((await templates.select(id, e.id)).productId === target.id, '模板未消费原商品合并')
  await f.dictionaries.rename('product', target.id, '改名苹果')
  check((await templates.list(id, 'EXPENSE')).items[0]?.displayName === '改名苹果', '模板改名联动丢失')
  await f.dictionaries.changeStatus('unit', f.unit.id, 'INACTIVE')
  const fallback = await templates.select(id, e.id)
  check(fallback.unavailableFields.join() === 'unitId' && !fallback.unitId && fallback.paidAmount === '16.00' && fallback.productId === target.id, '失效字段回退扩大或漏提示')
  await refused(() => templates.upsert(id, expense.id), 'VALIDATION_FAILED')
  await database.write(sql => sql.run('DELETE FROM ledger_entry WHERE id=?', [income.id]))
  check((await templates.select(id, i.id)).incomeName === '测试工资', '来源删除后模板丢失')
  await templates.remove(id, e.id)
  await templates.remove(id, e.id)
  check((await database.read(sql => sql.query('SELECT id FROM ledger_entry WHERE id=?', [expense.id]))).length === 1, '移除模板删除了原账目')
  await database.close()
  await database.open()
  check((await templates.list(id, 'INCOME')).items[0]?.id === i.id, '模板没有跨重启保存')
  return 'templates-upsert-whitelist-merge-rename-invalid-fallback-source-delete-remove'
}

export async function personalDatasetScenario(database: LedgerDatabase) {
  const id = await datasetId(database)
  const drafts = new DraftService(database)
  const preferences = new PreferenceService(database)
  const templates = new TemplateService(database)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const switchDataset = database.write(async sql => {
    await gate
    await sql.run("UPDATE ledger_meta SET dataset_id='replacement-dataset'")
  })
  const stale = [drafts.save(id, 'EXPENSE', { note: '旧任务' }), preferences.save(id, { themeMode: 'DARK' }), templates.remove(id, 'stale-template')]
  release()
  await switchDataset
  for (const task of stale) {
    await refused(() => task, 'DATASET_CHANGED')
  }
  check((await database.read(sql => sql.query('SELECT * FROM ledger_draft'))).length === 0, '旧异步写污染新库')
  check((await preferences.read('replacement-dataset')).themeMode === 'SYSTEM', '旧偏好写污染新库')
  return 'queued-old-dataset-writes-refused-in-transaction'
}

export async function personalUpgradeScenario(manager: (suffix: string, chain?: readonly Migration[]) => LedgerDatabase) {
  const old = manager('personal_upgrade', migrations.slice(0, 4))
  const current = manager('personal_upgrade')
  const failed = manager('personal_upgrade', [...migrations.slice(0, 4), { ...migrations[4]!, sql: migrations[4]!.sql + '\nINSERT INTO controlled_missing_table VALUES(1);' }])
  try {
    await old.open()
    const id = await datasetId(old)
    await old.write(async sql => {
      await sql.run("UPDATE preference SET value='\"DARK\"' WHERE key='theme'")
      await sql.run("DELETE FROM preference WHERE key='recentEntryType'")
      for (const [key, value] of [['future_false', 'false'], ['future_zero', '0'], ['future_empty', '""']]) {
        await sql.run('INSERT INTO preference VALUES(?,?)', [key!, value!])
      }
    })
    await old.close()
    await refused(() => failed.open())
    await old.open()
    check((await old.read(sql => sql.query('SELECT schema_version FROM ledger_meta')))[0]?.schema_version === 4, '失败迁移推进版本')
    check((await old.read(sql => sql.query("SELECT name FROM sqlite_master WHERE name='ledger_draft'"))).length === 0, '失败迁移留下草稿表')
    await old.close()
    await current.open()
    check(await datasetId(current) === id, '升级改变数据集')
    const preferences = await new PreferenceService(current).read(id)
    check(preferences.themeMode === 'DARK' && preferences.recentEntryType === 'EXPENSE', '补缺省覆盖用户值或遗漏缺失字段')
    const rows = await current.read(sql => sql.query("SELECT value FROM preference WHERE key LIKE 'future_%' ORDER BY key"))
    check(JSON.stringify(rows.map(row => row.value)) === '["\\\"\\\"","false","0"]', '升级覆盖 false/0/空值')
    await new DraftService(current).save(id, 'INCOME', { amount: '20' })
    return 'v4-v5-upgrade-preserves-user-values-and-adds-only-missing-defaults'
  } finally {
    await old.close()
    await current.close()
    await failed.close()
  }
}
