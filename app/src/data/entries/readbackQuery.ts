import type { LedgerFilters, LedgerItem, LedgerPage } from '../../api/ledgerEntries'
import type { LedgerDatabase } from '../ledgerDatabase'
import { fromSqliteInteger, scaledIntegerToDecimal } from '../../domain/money'
import { fieldError, requireId } from '../dictionaries/repository'
import { compileLedgerFilter, readbackProjection } from './querySql'
import { isBusinessDate as validDate } from '../../domain/businessDates'
export const LEDGER_PAGE_SIZE = 20
const sortColumns = ['business_date', 'business_time', 'created_at', 'id'] as const
/** 统一有效账目、调整和回收站查询；SQL 过滤、每批 20 笔，游标绑定条件/日期边界及数据集。 */
export class EntryReadbackQuery {
  constructor(private readonly database: Pick<LedgerDatabase, 'read'>, private readonly clock = () => new Date()) {}

  async list(filters: LedgerFilters, cursor?: string, signal?: AbortSignal): Promise<LedgerPage> {
    const { conditions, values, signature } = compileLedgerFilter(filters, this.clock())
    return this.database.read(async sql => {
      const dataset = String((await sql.query('SELECT dataset_id FROM ledger_meta WHERE singleton=1'))[0]!.dataset_id)
      const clauses = [...conditions]
      const parameters = [...values]
      if (cursor !== undefined) {
        try {
          if (cursor.length > 8192) throw new Error('cursor too long')
          const decoded = JSON.parse(decodeURIComponent(cursor))
          if (decoded.version !== 1 || decoded.dataset !== dataset || decoded.signature !== signature ||
            !Array.isArray(decoded.keys) || decoded.keys.length !== 4 || !validDate(decoded.keys[0]) ||
            !Number.isFinite(Date.parse(decoded.keys[1])) || typeof decoded.keys[2] !== 'string' ||
            decoded.keys[2] !== '' && !Number.isFinite(Date.parse(decoded.keys[2]))) throw new Error('cursor mismatch')
          requireId(decoded.keys[3])
          clauses.push(`(${sortColumns.join(',')})<(?,?,?,?)`)
          parameters.push(...decoded.keys)
        } catch {
          throw fieldError('cursor', '分页位置无效，请重新加载。')
        }
      }
      const rows = await sql.query(`SELECT * FROM (${readbackProjection}) WHERE ${clauses.join(' AND ')}
        ORDER BY business_date DESC,business_time DESC,created_at DESC,id DESC LIMIT ${LEDGER_PAGE_SIZE + 1}`, parameters)
      const page = rows.slice(0, LEDGER_PAGE_SIZE)
      const last = page.at(-1)
      return {
        items: page.map(row => this.item(row)), hasMore: rows.length > LEDGER_PAGE_SIZE,
        ...(rows.length > LEDGER_PAGE_SIZE ? { nextCursor: encodeURIComponent(JSON.stringify({ version: 1, dataset, signature,
          keys: sortColumns.map(key => last![key]) })) } : {}),
      }
    }, signal)
  }

  private item(row: Record<string, unknown>): LedgerItem {
    const expense = row.entry_type === 'EXPENSE'
    const adjustment = row.entry_type === 'ADJUSTMENT'
    const amount = fromSqliteInteger(row.amount_text)
    const total = fromSqliteInteger(row.adjusted_text)
    const trashed = row.lifecycle_status === 'TRASHED'
    return {
      id: String(row.id), entryType: row.entry_type as LedgerItem['entryType'], occurredAt: String(row.business_time), businessDate: String(row.business_date),
      title: String(row.title), categoryName: String(row.category_name),
      counterpartyName: expense ? `${row.quantity_text == null ? '' : scaledIntegerToDecimal(fromSqliteInteger(row.quantity_text), 3)} ${row.unit_name_snapshot ?? ''}`.trim() : String(row.counterparty_name),
      fundingChannelName: String(row.funding_channel_name_snapshot), amount: scaledIntegerToDecimal(amount, 2),
      ...(row.note == null ? {} : { note: String(row.note) }), createdAt: String(row.created_at), version: Number(row.row_version),
      lifecycleStatus: trashed ? 'TRASHED' : adjustment ? 'EFFECTIVE' : 'ACTIVE',
      adjustmentType: adjustment ? row.adjustment_type as LedgerItem['adjustmentType'] : null,
      originalExpenseId: adjustment ? String(row.original_expense_id) : null,
      effectiveAdjustmentAmount: expense ? scaledIntegerToDecimal(total, 2) : null,
      netExpenseAmount: expense ? scaledIntegerToDecimal(amount - total, 2) : null,
      fullyAdjusted: expense && total > 0n && total === amount, linkedAdjustmentCount: Number(row.linked_count),
      ...(trashed ? { deletedAt: String(row.deleted_at), purgeAfter: String(row.purge_after),
        remainingDays: Math.max(0, Math.ceil((Date.parse(String(row.purge_after)) - this.clock().getTime()) / 86_400_000)) } : {}),
    }
  }

}
