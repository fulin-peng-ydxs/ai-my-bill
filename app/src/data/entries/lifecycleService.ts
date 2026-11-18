import type { LedgerDatabase, SqlSession } from '../ledgerDatabase'
import type { LedgerLifecycleResponse } from '../../api/ledgerLifecycle'
import { sha256 } from '../migrations'
import { LocalError } from '../../domain/localError'
import { fromSqliteInteger } from '../../domain/money'
import { requireId } from '../dictionaries/repository'
import { expectedVersion, operationId } from './writePolicy'
import { refreshRecent } from './repository'
import { assertDataset } from '../personal/datasetScope'
import { effectiveTotal } from './adjustmentService'

export type LifecycleItem = { id: string; entryType: 'EXPENSE' | 'INCOME' | 'ADJUSTMENT'; version: number }
export const DAY = 86_400_000
export const retention = 30 * DAY
export const lifecycleConflict = () => new LocalError('LEDGER_LIFECYCLE_CONFLICT', '账目状态已变化或 30 天恢复期限已结束，请刷新后重试。')

/** 手动操作维护幂等回执、版本及联动状态；自动清理遵循相同的子项优先删除顺序。 */
export class LifecycleService {
  constructor(private readonly database: Pick<LedgerDatabase, 'executeOnce'>, private readonly clock = () => new Date()) {}

  async change(dataset: string, item: LifecycleItem, action: 'trash' | 'restore' | 'purge', requestedKey: string, includeAdjustments = false): Promise<LedgerLifecycleResponse | undefined> {
    requireId(item.id)
    expectedVersion(item.version)
    if (!['EXPENSE', 'INCOME', 'ADJUSTMENT'].includes(item.entryType) || !['trash', 'restore', 'purge'].includes(action)) {
      throw lifecycleConflict()
    }
    const key = operationId(requestedKey)
    const digest = await sha256(JSON.stringify({ dataset, item, action, includeAdjustments }))
    let response: LedgerLifecycleResponse | undefined
    await this.database.executeOnce(`lifecycle.${action}`, key, digest, async sql => {
      await assertDataset(sql, dataset)
      const current = await lifecycleRow(sql, item)
      const now = this.clock()
      if (Number(current.row_version) !== item.version) {
        throw lifecycleConflict()
      }
      const adjustment = item.entryType === 'ADJUSTMENT'
      const status = String(current.status ?? current.lifecycle_status)
      if (action === 'purge') {
        if (status !== 'TRASHED') {
          throw lifecycleConflict()
        }
        if (!adjustment && Number(current.linked_count) && !includeAdjustments) {
          throw new LocalError('LEDGER_HAS_ADJUSTMENTS', '原支出存在关联调整，请明确确认连同删除。')
        }
        await purgeRow(sql, item, now.toISOString())
        return { id: item.id, purged: true as const, entryType: item.entryType, version: item.version }
      }
      if (action === 'trash' ? status !== (adjustment ? 'EFFECTIVE' : 'ACTIVE')
        : status !== 'TRASHED' || Date.parse(String(current.purge_after)) <= now.getTime()) {
        throw lifecycleConflict()
      }
      if (action === 'restore' && adjustment) {
        const source = (await sql.query("SELECT CAST(amount_cents AS TEXT) AS paid FROM ledger_entry WHERE id=? AND lifecycle_status='ACTIVE'", [String(current.original_expense_id)]))[0]
        if (!source || await effectiveTotal(sql, String(current.original_expense_id)) + fromSqliteInteger(current.amount_text) > fromSqliteInteger(source.paid)) {
          throw lifecycleConflict()
        }
      }
      if (action === 'restore' && item.entryType === 'EXPENSE') {
        const total = (await sql.query("SELECT CAST(COALESCE(SUM(amount_cents),0) AS TEXT) AS total FROM expense_adjustment WHERE original_expense_id=? AND status IN ('EFFECTIVE','SOURCE_FROZEN')", [item.id]))[0]!.total
        const paid = (await sql.query('SELECT CAST(amount_cents AS TEXT) AS paid FROM ledger_entry WHERE id=?', [item.id]))[0]!.paid
        if (fromSqliteInteger(total) > fromSqliteInteger(paid)) {
          throw lifecycleConflict()
        }
      }
      const table = adjustment ? 'expense_adjustment' : 'ledger_entry'
      const column = adjustment ? 'status' : 'lifecycle_status'
      const next = action === 'trash' ? 'TRASHED' : adjustment ? 'EFFECTIVE' : 'ACTIVE'
      await sql.run(`UPDATE ${table} SET ${column}=?,deleted_at=?,purge_after=?,updated_at=?,row_version=row_version+1 WHERE id=? AND row_version=?`,
        [next, action === 'trash' ? now.toISOString() : null, action === 'trash' ? new Date(now.getTime() + retention).toISOString() : null, now.toISOString(), item.id, item.version])
      if (!adjustment) {
        await refreshRecent(sql, item.entryType as 'EXPENSE' | 'INCOME', String(item.entryType === 'EXPENSE' ? current.product_id : current.payer_id), now.toISOString())
      }
      return { ...lifecycleResponse(item, await lifecycleRow(sql, item)), purged: false as const }
    }, undefined, async (sql, saved) => {
      await assertDataset(sql, dataset)
      if (saved.purged) {
        return
      }
      const current = lifecycleResponse(item, await lifecycleRow(sql, item))
      if (current.version !== saved.version || current.lifecycleStatus !== saved.lifecycleStatus) {
        throw lifecycleConflict()
      }
      response = current
    })
    return response
  }
}

export async function lifecycleRow(sql: SqlSession, item: Pick<LifecycleItem, 'id' | 'entryType'>) {
  const adjustment = item.entryType === 'ADJUSTMENT'
  const row = (await sql.query(adjustment
    ? 'SELECT a.*,CAST(amount_cents AS TEXT) AS amount_text,0 AS linked_count FROM expense_adjustment a WHERE id=?'
    : `SELECT l.*,(SELECT COUNT(*) FROM expense_adjustment a WHERE a.original_expense_id=l.id) AS linked_count FROM ledger_entry l WHERE id=? AND entry_type=?`,
  adjustment ? [item.id] : [item.id, item.entryType]))[0]
  if (!row) {
    throw new LocalError('LEDGER_ENTRY_NOT_FOUND', '账目不存在或已永久删除。')
  }
  return row
}
function lifecycleResponse(item: Pick<LifecycleItem, 'id' | 'entryType'>, row: Record<string, unknown>): LedgerLifecycleResponse {
  return { id: item.id, entryType: item.entryType, version: Number(row.row_version),
    lifecycleStatus: String(row.status ?? row.lifecycle_status) as LedgerLifecycleResponse['lifecycleStatus'],
    ...(row.deleted_at == null ? {} : { deletedAt: String(row.deleted_at), purgeAfter: String(row.purge_after) }), linkedAdjustmentCount: Number(row.linked_count) }
}
export async function purgeRow(sql: SqlSession, item: Pick<LifecycleItem, 'id' | 'entryType'>, now: string) {
  if (item.entryType === 'ADJUSTMENT') {
    await sql.run('DELETE FROM expense_adjustment WHERE id=?', [item.id])
    return
  }
  const row = await lifecycleRow(sql, item)
  await sql.run('DELETE FROM expense_adjustment WHERE original_expense_id=?', [item.id])
  await sql.run('DELETE FROM ledger_entry WHERE id=?', [item.id])
  await refreshRecent(sql, item.entryType, String(item.entryType === 'EXPENSE' ? row.product_id : row.payer_id), now)
}
