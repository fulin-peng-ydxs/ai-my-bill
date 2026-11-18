import { afterAll, afterEach, beforeEach, describe, it, vi, expect } from 'vitest'
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
import { entryFixture, entryWriteScenario, entryValidationScenario, entryFailureUndoScenario, legacyEntryFixture,
  entryReplayScenario, entrySearchScenario, entrySearchUpgradeScenario } from '../../../test-support/entryScenarios'
import { EntryReadbackQuery } from './readbackQuery'
import { EntryService } from './entryService'
import { migrations } from '../migrations'

let database: LedgerDatabase
let counter = 0
beforeEach(async () => {
  database = new LedgerDatabase(`entry_${++counter}`)
  await database.open()
})
afterEach(() => database.close())
afterAll(() => state.fixture!.dispose())

describe('T6 真实 SQLite 写入闭环', () => {
  it('精确量价、快照、并发、幂等、旧版本编辑、丢弃确认后重开', () => entryWriteScenario(database))
  it('精度、上限、Unicode、时间、失效字典和字段错误', () => entryValidationScenario(database))
  it('最终回执故障整笔回滚、原键重试与撤销保护', () => entryFailureUndoScenario(database))
  it('已提交回放跳过时钟校验，旧编辑回放进入版本冲突', () => entryReplayScenario(database))
  it('全角、空白、大小写及组合字符沿历史快照名称检索', () => entrySearchScenario(database))
  it('v3→v4 跨批次回填、故障回滚及数据步骤摘要保护', () => entrySearchUpgradeScenario(
    (suffix, chain) => new LedgerDatabase(`entry_${counter}_${suffix}`, chain)))
  it('提交本身失败后不留下业务/回执，原键可重试', async () => {
    const f = await entryFixture(database)
    const commit = vi.spyOn(state.fixture!.sqlite, 'commitTransaction').mockRejectedValueOnce(new Error('controlled-commit-failure'))
    await expect(f.service.createIncome(f.income, 'failed-commit')).rejects.toThrow('controlled-commit-failure')
    commit.mockRestore()
    expect((await database.read(sql => sql.query('SELECT count(*) AS n FROM ledger_entry')))[0]?.n).toBe(0)
    expect((await f.service.createIncome(f.income, 'failed-commit')).version).toBe(1)
  })
  it('从 v2 升级保留用户字典/偏好/数据集，不虚构历史量价', async () => {
    await database.close()
    // 独立旧版夹具，不降级已经建立的当前库。
    const legacy = new LedgerDatabase(`legacy_entry_${counter}`, migrations.slice(0, 2))
    await legacy.open()
    const before = await legacy.read(sql => sql.query('SELECT * FROM ledger_meta'))
    await legacyEntryFixture(legacy)
    await legacy.close()
    const upgraded = new LedgerDatabase(legacy.name)
    try {
      await upgraded.open()
      expect((await upgraded.read(sql => sql.query('SELECT * FROM ledger_meta')))[0]?.dataset_id).toBe(before[0]?.dataset_id)
      expect((await upgraded.read(sql => sql.query("SELECT value FROM preference WHERE key='theme'")))[0]?.value).toBe('"DARK"')
      expect((await upgraded.read(sql => sql.query('SELECT count(*) AS n FROM dictionary_item')))[0]?.n).toBe(9)
      expect((await upgraded.read(sql => sql.query("SELECT CAST(amount_cents AS TEXT) AS cents,unit_price_scaled,quantity_scaled FROM ledger_entry WHERE id='legacy-entry'")))[0])
        .toMatchObject({ cents: '1500', unit_price_scaled: null, quantity_scaled: null })
    } finally {
      await upgraded.close()
    }
  })
  it('原明细回读 20 笔分页，拒绝另一类型专属条件', async () => {
    const f = await entryFixture(database)
    for (let i = 0; i < 52; i++) {
      await f.service.createIncome({ ...f.income, incomeName: `测试${i}` }, `page-${i}`)
    }
    const query = new EntryReadbackQuery(database, () => f.now)
    const filter = { query: '', type: 'INCOME' as const, lifecycle: 'ACTIVE' as const, range: 'TODAY' as const }
    const first = await query.list(filter)
    const second = await query.list(filter, first.nextCursor)
    expect(first.items).toHaveLength(20)
    const third = await query.list(filter, second.nextCursor)
    expect(second.items).toHaveLength(20)
    expect(third.items).toHaveLength(12)
    expect(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size).toBe(52)
    await expect(query.list({ ...filter, primaryCategoryId: f.category.id })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(query.list({ ...filter, query: '别的' }, first.nextCursor)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
  it('原 API 直连本地，只有提交后广播，失败安全回传且不联网', async () => {
    const { appDatabase } = await import('../appDatabase')
    const expenses = await import('../../api/expenses')
    const incomes = await import('../../api/incomes')
    const { listLedgerEntries } = await import('../../api/ledgerEntries')
    const dispatch = vi.fn().mockReturnValue(true)
    vi.stubGlobal('dispatchEvent', dispatch)
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('不得联网'))
    await appDatabase.open()
    try {
      const f = await entryFixture(appDatabase, new Date())
      const saved = await expenses.createExpense(f.expense, 'api-expense')
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect((await expenses.getExpense(saved.id)).paidAmount).toBe('15.00')
      const received = await incomes.createIncome(f.income, 'api-income')
      expect((await incomes.getIncome(received.id)).incomeName).toBe('测试工资')
      expect((await incomes.listRecentIncomeNames('')).items).toContain('测试工资')
      expect((await listLedgerEntries({ query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'TODAY' })).items).toHaveLength(2)
      await appDatabase.write(sql => sql.run("CREATE TEMP TRIGGER fail_api_receipt BEFORE INSERT ON idempotency_result BEGIN SELECT RAISE(ABORT,'controlled-sensitive-sql'); END;"))
      const error = await incomes.createIncome(f.income, 'api-failure').catch(cause => cause)
      expect(error.code).toBe('LOCAL_DATABASE_FAILED')
      expect(error.retryable).toBe(true)
      expect(JSON.stringify(error)).not.toContain('controlled-sensitive-sql')
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await appDatabase.close()
      fetch.mockRestore()
      vi.unstubAllGlobals()
    }
  })
  it('收入撤销回收最近值，模板关联和过期阻止撤销；编辑更换商品回算旧值', async () => {
    const f = await entryFixture(database)
    const income = await f.service.createIncome(f.income, 'undo-payer')
    await f.service.undo('INCOME', income.id, 'undo-payer')
    await f.service.undo('INCOME', income.id, 'undo-payer')
    expect(await database.read(sql => sql.query('SELECT * FROM payer_details'))).toHaveLength(0)
    const protectedIncome = await f.service.createIncome(f.income, 'protected-income')
    await database.write(sql => sql.run(`INSERT INTO daily_entry_template(id,entry_type,display_name,normalized_name,source_record_id,
      payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,amount_cents,funding_channel_id,funding_channel_name_snapshot,
      last_used_at,created_at,updated_at) VALUES('linked','INCOME','关联收入','关联收入',?,?,'合成公司',?,'工资',100000,?,'现金',?,?,?)`,
    [protectedIncome.id, f.payer.id, f.income.incomeCategoryId, f.funding.id, f.now.toISOString(), f.now.toISOString(), f.now.toISOString()]))
    await expect(f.service.undo('INCOME', protectedIncome.id, 'protected-income')).rejects.toMatchObject({ code: 'INCOME_NOT_UNDOABLE' })
    await database.write(sql => sql.run("DELETE FROM daily_entry_template WHERE id='linked'"))
    const expired = new EntryService(database, () => new Date(f.now.getTime() + 86_400_001))
    await expect(expired.undo('INCOME', protectedIncome.id, 'protected-income')).rejects.toMatchObject({ code: 'INCOME_NOT_UNDOABLE' })
    const expense = await f.service.createExpense(f.expense, 'old-product')
    const other = await f.dictionaries.create('product', '另一商品')
    await f.service.updateExpense(expense.id, { version: 1, entry: { ...f.expense, productId: other.id } }, 'new-product')
    const rows = await database.read(sql => sql.query('SELECT product_id,CAST(last_unit_price_scaled AS TEXT) AS price FROM product_details'))
    expect(rows.find(row => row.product_id === f.product.id)?.price).toBeNull()
    expect(rows.find(row => row.product_id === other.id)?.price).toBe('123456')
  })
})
