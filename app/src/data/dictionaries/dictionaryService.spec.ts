import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createSqliteBridge } from '../../../test-support/sqliteBridge'

const state = vi.hoisted(() => ({ fixture: undefined as ReturnType<typeof createSqliteBridge> | undefined }))
vi.mock('@capacitor/core', async () => {
  const { createSqliteBridge } = await import('../../../test-support/sqliteBridge')
  const fixture = createSqliteBridge()
  state.fixture = fixture
  return {
    Capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true },
    registerPlugin: (name: string) => name === 'CapacitorSQLite' ? fixture.sqlite : fixture.files,
  }
})

import { dictionaryUpgradeScenario } from '../../../test-support/dictionaryUpgradeScenario'
import { LedgerDatabase } from '../ledgerDatabase'
import {
  dictionaryCrudScenario, dictionaryTypes, dictionaryValidationScenario,
  dictionarySortScenario, dictionaryReferencesScenario, dictionaryMergeScenario, dictionaryTemplateScenario,
} from '../../../test-support/dictionaryScenarios'

let database: LedgerDatabase
let counter = 0
beforeEach(async () => {
  database = new LedgerDatabase(`dictionary_${++counter}`)
  await database.open()
})
afterEach(async () => {
  await database.close()
})
afterAll(() => state.fixture!.dispose())

describe('T5 本地字典 SQLite 闭环', () => {
  it.each(dictionaryTypes)('%s 新增/改名/停用/恢复及索引/候选一致', async type => {
    await dictionaryCrudScenario(database, type)
  })
  it('名称、Unicode 长度、层级、分页和取消边界', async () => {
    await dictionaryValidationScenario(database)
  })
  it('同级排序、跨层拒绝及实际语句中途失败原子回滚', async () => {
    await dictionarySortScenario(database)
  })
  it('引用类型、删除保护、停用回显与历史名称快照', async () => {
    await dictionaryReferencesScenario(database)
  })
  it.each(['source-only', 'target-newer', 'rename-conflict'] as const)('模板边界 %s', async variant => {
    await dictionaryTemplateScenario(database, variant)
  })
  it('v1 升级保护用户配置，新 seed 只用于新账本，必需迁移冲突拒绝且可重跑', async () => {
    await dictionaryUpgradeScenario((suffix, chain, seed) => new LedgerDatabase(`upgrade_${counter}_${suffix}`, chain, seed))
  })
  it('合并预览、模板冲突、故障回滚、重复提交和重开后的去向', async () => {
    await dictionaryMergeScenario(database)
  })
})

describe('原页面 API 的本地接入', () => {
  it('共享启动账本、保留 DTO/字段错误，提交后才通知，SQL 失败不泄露内部信息或联网', async () => {
    const { appDatabase } = await import('../appDatabase')
    const api = await import('../../api/dictionaries')
    const { listExpenseProducts } = await import('../../api/expenses')
    const { normalizeRequestError } = await import('../../api/errors')
    const dispatch = vi.fn().mockReturnValue(true)
    vi.stubGlobal('dispatchEvent', dispatch)
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('不得发网络请求'))
    await appDatabase.open()
    try {
      const item = await api.createDictionaryItem('product', 'API 苹果')
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect((await listExpenseProducts('API')).items.map(row => row.id)).toContain(item.id)
      await expect(api.createDictionaryItem('product', 'ＡＰＩ 苹果')).rejects.toMatchObject({ code: 'DICTIONARY_NAME_CONFLICT' })
      expect(dispatch).toHaveBeenCalledTimes(1)
      await api.renameDictionaryItem('product', item.id, 'API 改名苹果')
      await api.changeDictionaryItemStatus('product', item.id, 'INACTIVE')
      expect(dispatch).toHaveBeenCalledTimes(3)
      expect((await api.getDictionaryItem('product', item.id)).status).toBe('INACTIVE')
      expect((await api.listDictionaryCandidates('product')).items.map(row => row.id)).not.toContain(item.id)
      expect((await listExpenseProducts('')).items.map(row => row.id)).not.toContain(item.id)
      expect((await api.listDictionarySummaries()).items).toHaveLength(8)
      await appDatabase.write(sql => sql.run("CREATE TEMP TRIGGER test_api_failure BEFORE INSERT ON dictionary_item BEGIN SELECT RAISE(ABORT,'controlled-sensitive-sql'); END;"))
      try {
        const error = await api.createDictionaryItem('unit', '失败单位').catch(cause => cause)
        expect(error.code).toBe('LOCAL_DATABASE_FAILED')
        expect(error.cause.message).toContain('controlled-sensitive-sql')
        expect(JSON.stringify(error)).not.toContain('controlled-sensitive-sql')
        expect(normalizeRequestError(error).message).toBe('本地操作未完成，请保留输入后重试。')
        expect(dispatch).toHaveBeenCalledTimes(3)
      } finally {
        await appDatabase.write(sql => sql.run('DROP TRIGGER temp.test_api_failure'))
      }
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      await appDatabase.close()
      fetch.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
