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
import { entryFixture } from '../../../test-support/entryScenarios'
import { EntryReadbackQuery } from './readbackQuery'
import { LedgerDatabase } from '../ledgerDatabase'
import { ledgerFilterScenario, ledgerPagingScenario, ledgerQueryUpgradeScenario } from '../../../test-support/ledgerQueryScenarios'
let db: LedgerDatabase
let counter = 0
beforeEach(async () => {
  db = new LedgerDatabase(`query_${++counter}`)
  await db.open()
})
afterEach(() => db.close())
afterAll(() => state.fixture!.dispose())
describe('T9 本地统一明细查询', () => {
  it.each(['长', '😀'])('200 字符收入名称可精确定位：%s', async char => {
    const f = await entryFixture(db)
    const name = char.repeat(200)
    const saved = await f.service.createIncome({ ...f.income, incomeName: name }, 'long-name')
    const result = await new EntryReadbackQuery(db, () => f.now).list({ query: '', type: 'INCOME', lifecycle: 'ACTIVE', range: 'TODAY', incomeName: name })
    expect(result.items.map(item => item.id)).toEqual([saved.id])
  })
  it('组合筛选、快照字面搜索和编辑后刷新', () => ledgerFilterScenario(db))
  it('20 笔稳定分页、跨日、增删恢复和数据集游标', () => ledgerPagingScenario(db))
  it('v6→v7 跨批回填、失败回滚和摘要兼容', () => ledgerQueryUpgradeScenario((suffix, chain) => new LedgerDatabase(`query_upgrade_${counter}_${suffix}`, chain)))
  it.each(['TODAY', 'THIS_MONTH'] as const)('上海跨午夜后 %s 旧游标拒绝，从首批读取新日期范围', async range => {
    const f = await entryFixture(db)
    for (let index = 0; index < 21; index++) {
      await f.service.createIncome({ ...f.income, incomeName: `午夜样本 ${index}` }, `midnight-${index}`)
    }
    let now = new Date('2026-11-17T15:59:59.000Z')
    const query = new EntryReadbackQuery(db, () => now)
    const filters = { query: '', type: 'INCOME' as const, lifecycle: 'ACTIVE' as const, range }
    const first = await query.list(filters)
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toBeTruthy()
    now = new Date('2026-11-17T16:00:01.000Z')
    await expect(query.list(filters, first.nextCursor)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', fieldErrors: [{ field: 'cursor', message: '分页位置无效，请重新加载。' }],
    })
    const fresh = await query.list(filters)
    if (range === 'TODAY') {
      expect(fresh.items).toEqual([])
      expect(fresh.hasMore).toBe(false)
    } else {
      const last = await query.list(filters, fresh.nextCursor)
      const all = [...fresh.items, ...last.items]
      expect(all).toHaveLength(21)
      expect(new Set(all.map(item => item.id)).size).toBe(21)
      expect(last.hasMore).toBe(false)
    }
  })
})
