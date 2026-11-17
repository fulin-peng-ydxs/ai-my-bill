import type { LedgerDatabase } from '../ledgerDatabase'
import type { EntryType } from '../../domain/preferences'
import { DRAFT_SCHEMA, DRAFT_TTL_MS, sanitizeDraft } from '../../domain/ledgerDraft'
import { LocalError } from '../../domain/localError'
import { assertDataset } from './datasetScope'

/** 所有读写绑定调用时的数据集；恢复/清空后的旧队列任务一律拒绝。 */
export class DraftService {
  constructor(private readonly database: Pick<LedgerDatabase, 'read' | 'write'>, private readonly clock = () => Date.now()) {}

  read(datasetId: string, type: EntryType) {
    return this.database.read(async sql => {
      await assertDataset(sql, datasetId)
      const row = (await sql.query(`SELECT schema_version,created_at,updated_at,
        CASE WHEN length(CAST(data_json AS BLOB))<=16384 THEN data_json ELSE NULL END AS data_json
        FROM ledger_draft WHERE dataset_id=? AND entry_type=?`, [datasetId, type]))[0]
      if (!row) {
        return {}
      }
      const created = Date.parse(String(row.created_at))
      const updated = Date.parse(String(row.updated_at))
      if (row.data_json == null || row.schema_version !== DRAFT_SCHEMA || !Number.isFinite(created) || !Number.isFinite(updated) || created > updated) {
        throw new LocalError('DRAFT_INVALID', '草稿版本或时间不兼容，原内容已保留。')
      }
      if (this.clock() - updated >= DRAFT_TTL_MS) {
        return {}
      }
      return sanitizeDraft(type, JSON.parse(String(row.data_json)))
    })
  }

  save(datasetId: string, type: EntryType, value: Record<string, string>) {
    const data = sanitizeDraft(type, value)
    const now = new Date(this.clock()).toISOString()
    return this.database.write(async sql => {
      await assertDataset(sql, datasetId)
      if (!Object.keys(data).length) {
        await sql.run('DELETE FROM ledger_draft WHERE dataset_id=? AND entry_type=?', [datasetId, type])
        return
      }
      await sql.run(`INSERT INTO ledger_draft VALUES(?,?,?,?,?,?) ON CONFLICT(dataset_id,entry_type) DO UPDATE SET
        schema_version=excluded.schema_version,data_json=excluded.data_json,created_at=MIN(ledger_draft.created_at,excluded.created_at),updated_at=excluded.updated_at`,
      [datasetId, type, DRAFT_SCHEMA, JSON.stringify(data), now, now])
    })
  }
}
