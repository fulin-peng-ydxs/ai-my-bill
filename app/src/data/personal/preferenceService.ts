import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'
import { DEFAULT_PREFERENCES, normalizePreferences, type PreferenceRequest, type Preferences } from '../../domain/preferences'
import { fieldError } from '../dictionaries/repository'
import { assertDataset } from './datasetScope'

// 沿用已存在的存储键，避免将安装包默认清单当成更新用户设置的配置。
const keys = { defaultFundingChannelId: 'defaultFundingChannelId', ledgerDefaultRange: 'ledgerRange',
  reportDefaultRange: 'reportRange', themeMode: 'theme', recentEntryType: 'recentEntryType' } as const

export class PreferenceService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'write'>) {}

  private async values(sql: SqlSession): Promise<Preferences> {
    const rows = await sql.query('SELECT key,value FROM preference')
    const raw = Object.fromEntries(rows.map(row => [String(row.key), JSON.parse(String(row.value))]))
    const result = normalizePreferences(Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, raw[key]])))
    let name: string | undefined
    if (result.defaultFundingChannelId) {
      const active = (await sql.query("SELECT name FROM dictionary_item WHERE id=? AND kind='FUNDING_CHANNEL' AND status='ACTIVE'", [result.defaultFundingChannelId]))[0]
      // 无效引用只作消费回退，保留原存储；用户启用该项后仍可恢复选择。
      if (active) {
        name = String(active.name)
      } else {
        result.defaultFundingChannelId = null
      }
    }
    return { ...result, ...(name ? { defaultFundingChannelName: name } : {}),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '1970-01-01T00:00:00.000Z' }
  }

  read(datasetId: string) {
    return this.database.read(async sql => {
      await assertDataset(sql, datasetId)
      return this.values(sql)
    })
  }

  save(datasetId: string, patch: Partial<PreferenceRequest>) {
    return this.database.write(async sql => {
      await assertDataset(sql, datasetId)
      const normalized = normalizePreferences(patch)
      for (const field of Object.keys(patch) as (keyof PreferenceRequest)[]) {
        if (!(field in keys) || patch[field] !== normalized[field]) {
          throw fieldError(field, '偏好值无效。')
        }
        if (field === 'defaultFundingChannelId' && patch[field] && !(await sql.query(
          "SELECT id FROM dictionary_item WHERE id=? AND kind='FUNDING_CHANNEL' AND status='ACTIVE'", [patch[field]!])).length) {
          throw fieldError(field, '请选择当前启用的资金渠道。')
        }
        await sql.run('INSERT INTO preference VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [keys[field], JSON.stringify(patch[field])])
      }
      await sql.run("INSERT INTO preference VALUES('updatedAt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify(new Date().toISOString())])
      return this.values(sql)
    })
  }

  reset(datasetId: string) {
    return this.save(datasetId, { ...DEFAULT_PREFERENCES })
  }
}
