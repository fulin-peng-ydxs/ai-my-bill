import type { LedgerFilters, LedgerItem, LedgerPage } from '../../api/ledgerEntries'
import type { LedgerDatabase } from '../ledgerDatabase'
import { formatShanghaiBusinessDate } from '../../domain/businessTime'
import { LocalError } from '../../domain/localError'
import { fromSqliteInteger, scaledIntegerToDecimal } from '../../domain/money'
import { fieldError, requireId, validateQuery } from '../dictionaries/repository'
import { entryProjection } from './repository'

/** T6 保存后从原明细入口回读/编辑；完整跨维查询与调整口径由 T9 接入。 */
export class EntryReadbackQuery {
  constructor(private readonly database: Pick<LedgerDatabase, 'read'>, private readonly clock = () => new Date()) {}

  async list(filters: LedgerFilters, cursor?: string, signal?: AbortSignal): Promise<LedgerPage> {
    const supported = new Set(['query', 'type', 'lifecycle', 'range', 'startDate', 'endDate', 'fundingChannelId', 'entryId'])
    if (Object.entries(filters).some(([key, value]) => value !== undefined && value !== '' && !supported.has(key)) ||
      filters.lifecycle !== 'ACTIVE' || !['ALL', 'EXPENSE', 'INCOME'].includes(filters.type)) {
      throw new LocalError('FEATURE_UNAVAILABLE', '当前阶段暂不支持该查询条件。')
    }
    const query = validateQuery(filters.query)
    const [start, end] = this.dateRange(filters)
    const conditions = ["lifecycle_status='ACTIVE'", 'business_date BETWEEN ? AND ?']
    const values: (string | number | null)[] = [start, end]
    if (filters.type !== 'ALL') {
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
      conditions.push("(instr(lower(COALESCE(product_name_snapshot,'')),?)>0 OR instr(COALESCE(normalized_income_name,''),?)>0)")
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
      const rows = await sql.query(`${entryProjection} WHERE ${conditions.join(' AND ')} ORDER BY business_time DESC,id DESC LIMIT 51`, values)
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
    const amount = scaledIntegerToDecimal(fromSqliteInteger(row.amount_text), 2)
    return {
      id: String(row.id), entryType: expense ? 'EXPENSE' : 'INCOME', occurredAt: String(row.business_time), businessDate: String(row.business_date),
      title: String(expense ? row.product_name_snapshot : row.income_name),
      categoryName: String(expense ? row.primary_category_name_snapshot : row.income_category_name_snapshot),
      counterpartyName: expense ? `${row.quantity_text == null ? '' : scaledIntegerToDecimal(fromSqliteInteger(row.quantity_text), 3)} ${row.unit_name_snapshot ?? ''}`.trim() : String(row.payer_name_snapshot),
      fundingChannelName: String(row.funding_channel_name_snapshot), amount,
      ...(row.note == null ? {} : { note: String(row.note) }), createdAt: String(row.created_at), version: Number(row.row_version),
      lifecycleStatus: 'ACTIVE', adjustmentType: null, originalExpenseId: null,
      effectiveAdjustmentAmount: expense ? '0.00' : null, netExpenseAmount: expense ? amount : null,
      fullyAdjusted: false, linkedAdjustmentCount: 0,
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
