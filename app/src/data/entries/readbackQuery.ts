import type { LedgerFilters, LedgerItem, LedgerPage } from '../../api/ledgerEntries'
import type { LedgerDatabase } from '../ledgerDatabase'
import { formatShanghaiBusinessDate } from '../../domain/businessTime'
import { LocalError } from '../../domain/localError'
import { fromSqliteInteger, scaledIntegerToDecimal } from '../../domain/money'
import { fieldError, requireId, validateQuery } from '../dictionaries/repository'
import { entryProjection } from './repository'

/** T6/T8 原明细与回收站的必要回读；跨维统一查询和下钻仍由 T9 承接。 */
export class EntryReadbackQuery {
  constructor(private readonly database: Pick<LedgerDatabase, 'read'>, private readonly clock = () => new Date()) {}

  async list(filters: LedgerFilters, cursor?: string, signal?: AbortSignal): Promise<LedgerPage> {
    const supported = new Set(['query', 'type', 'lifecycle', 'range', 'startDate', 'endDate', 'fundingChannelId', 'entryId'])
    if (Object.entries(filters).some(([key, value]) => value !== undefined && value !== '' && !supported.has(key)) ||
      !['ACTIVE', 'TRASHED'].includes(filters.lifecycle) || !['ALL', 'EXPENSE', 'INCOME', 'ADJUSTMENT', 'EXPENSE_FLOW'].includes(filters.type)) {
      throw new LocalError('FEATURE_UNAVAILABLE', '当前阶段暂不支持该查询条件。')
    }
    const query = validateQuery(filters.query)
    const [start, end] = this.dateRange(filters)
    const conditions = ['lifecycle_status=?', 'business_date BETWEEN ? AND ?']
    const values: (string | number | null)[] = [filters.lifecycle, start, end]
    if (filters.type === 'EXPENSE_FLOW') {
      conditions.push("entry_type IN ('EXPENSE','ADJUSTMENT')")
    } else if (filters.type !== 'ALL') {
      conditions.push('entry_type=?')
      values.push(filters.type)
    }
    for (const [column, id] of [['funding_channel_id', filters.fundingChannelId], ['id', filters.entryId]]) {
      if (id) {
        requireId(id)
        conditions.push(`${column}=?`)
        values.push(id)
      }
    }
    if (query) {
      // 原表单只需名称检索；T9 扩展统一搜索，不把未支持维度静默忽略。
      conditions.push("(instr(COALESCE(normalized_product_name_snapshot,''),?)>0 OR instr(COALESCE(normalized_income_name,''),?)>0)")
      values.push(query, query)
    }
    if (cursor) {
      try {
        const decoded = JSON.parse(decodeURIComponent(cursor))
        if (decoded.filters !== JSON.stringify(filters) || typeof decoded.time !== 'string' || !Number.isFinite(Date.parse(decoded.time))) {
          throw new Error('cursor mismatch')
        }
        requireId(decoded.id)
        conditions.push('(business_time<? OR (business_time=? AND id<?))')
        values.push(decoded.time, decoded.time, decoded.id)
      } catch {
        throw fieldError('cursor', '分页位置无效，请重新加载。')
      }
    }
    return this.database.read(async sql => {
      const rows = await sql.query(`SELECT * FROM (${readbackProjection}) WHERE ${conditions.join(' AND ')} ORDER BY business_time DESC,id DESC LIMIT 51`, values)
      const page = rows.slice(0, 50)
      const last = page.at(-1)
      return {
        items: page.map(row => this.item(row)), hasMore: rows.length > 50,
        ...(rows.length > 50 ? { nextCursor: encodeURIComponent(JSON.stringify({ filters: JSON.stringify(filters), time: last!.business_time, id: last!.id })) } : {}),
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

  private dateRange(filters: LedgerFilters): [string, string] {
    const today = formatShanghaiBusinessDate(this.clock())
    const date = new Date(`${today}T00:00:00Z`)
    const iso = (value: Date) => value.toISOString().slice(0, 10)
    switch (filters.range) {
      case 'TODAY': return [today, today]
      case 'THIS_WEEK': {
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
        return [iso(date), today]
      }
      case 'THIS_MONTH': return [`${today.slice(0, 7)}-01`, today]
      case 'THIS_YEAR': return [`${today.slice(0, 4)}-01-01`, today]
      case 'LAST_MONTH': {
        date.setUTCDate(0)
        return [`${iso(date).slice(0, 7)}-01`, iso(date)]
      }
      case 'CUSTOM': {
        const valid = (value?: string): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
        if (valid(filters.startDate) && valid(filters.endDate) && filters.startDate <= filters.endDate) {
          return [filters.startDate, filters.endDate]
        }
      }
    }
    throw fieldError('range', '请选择有效的日期范围。')
  }
}

// 同一投影供有效明细、净支出构成和回收站消费；调整只冲减支出，不混成收入。
const readbackProjection = `SELECT e.id,e.entry_type,e.business_time,e.business_date,e.amount_text,e.adjusted_text,e.linked_count,
  e.funding_channel_id,e.funding_channel_name_snapshot,e.note,e.created_at,e.row_version,e.lifecycle_status,e.deleted_at,e.purge_after,
  e.normalized_product_name_snapshot,e.normalized_income_name,
  CASE WHEN e.entry_type='EXPENSE' THEN e.product_name_snapshot ELSE e.income_name END AS title,
  CASE WHEN e.entry_type='EXPENSE' THEN e.primary_category_name_snapshot ELSE e.income_category_name_snapshot END AS category_name,
  CASE WHEN e.entry_type='EXPENSE' THEN COALESCE(e.quantity_text,'') || ' ' || COALESCE(e.unit_name_snapshot,'') ELSE e.payer_name_snapshot END AS counterparty_name,
  NULL AS adjustment_type,NULL AS original_expense_id,e.quantity_text,e.unit_name_snapshot FROM (${entryProjection}) e
  UNION ALL
  SELECT a.id,'ADJUSTMENT',a.business_time,a.business_date,CAST(a.amount_cents AS TEXT),'0',0,
  l.funding_channel_id,l.funding_channel_name_snapshot,a.note,a.created_at,a.row_version,
  CASE WHEN a.status='TRASHED' THEN 'TRASHED' ELSE 'ACTIVE' END,a.deleted_at,a.purge_after,
  l.normalized_product_name_snapshot,NULL,l.product_name_snapshot,
  CASE WHEN a.adjustment_type='REFUND' THEN '退款' ELSE '报销' END,l.product_name_snapshot,a.adjustment_type,a.original_expense_id,NULL,NULL
  FROM expense_adjustment a JOIN ledger_entry l ON l.id=a.original_expense_id
  WHERE a.status='TRASHED' OR (a.status='EFFECTIVE' AND l.lifecycle_status='ACTIVE')`
