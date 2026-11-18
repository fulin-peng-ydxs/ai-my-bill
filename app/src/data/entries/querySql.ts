import type { LedgerFilters } from '../../api/ledgerEntries'
import { fieldError, requireId } from '../dictionaries/repository'
import { entryProjection } from './repository'
import { clearIncompatibleLedgerFilters, expenseFilterKeys, incomeFilterKeys } from '../../domain/ledgerQuery'
import { normalizedDictionaryName } from '../../domain/dictionaryNameV1'
import { unicodeCodePointLength } from '../../domain/text'
import { resolveLedgerDateRange } from '../../domain/businessDates'

const idFields = { fundingChannelId: 'funding_channel_id', primaryCategoryId: 'primary_category_id',
  secondaryCategoryId: 'secondary_category_id', productId: 'product_id', unitId: 'unit_id', purchaseChannelId: 'purchase_channel_id',
  locationLabelId: 'location_label_id', incomeCategoryId: 'income_category_id', payerId: 'payer_id', entryId: 'id' } as const
const absentFields = { missingSecondaryCategory: 'secondary_category_id', missingPurchaseChannel: 'purchase_channel_id', missingLocation: 'location_label_id' } as const
const timeBands = { NIGHT: [0, 5], MORNING: [6, 11], AFTERNOON: [12, 17], EVENING: [18, 23] } as const

/** 明细与报表消费同一参数化过滤，类型、历史快照和有效状态不能各自演化。 */
export function compileLedgerFilter(filters: LedgerFilters, now: Date) {
  const supported = new Set(['query', 'type', 'lifecycle', 'range', 'startDate', 'endDate', ...Object.keys(idFields),
    ...Object.keys(absentFields), 'incomeName', 'expenseWeekday', 'expenseTimeBand'])
  if (Object.keys(filters).some(key => !supported.has(key)) ||
    !['ACTIVE', 'TRASHED'].includes(filters.lifecycle) || !['ALL', 'EXPENSE', 'INCOME', 'ADJUSTMENT', 'EXPENSE_FLOW'].includes(filters.type)) {
    throw fieldError('type', '请选择有效的查询条件。')
  }
  const compatible = clearIncompatibleLedgerFilters(filters)
  if ([...expenseFilterKeys, ...incomeFilterKeys].some(key => filters[key] !== undefined && filters[key] !== false && filters[key] !== '' && compatible[key] === undefined)) {
    throw fieldError('type', '当前账目类型包含不适用的筛选条件。')
  }
  if (typeof filters.query !== 'string' || unicodeCodePointLength(filters.query) > 200) {
    throw fieldError('query', '搜索内容不能超过 200 个字符。')
  }
  const query = normalizedDictionaryName(filters.query)
  let start: string, end: string
  try { [start, end] = resolveLedgerDateRange(filters, now) }
  catch { throw fieldError('range', '请选择有效的日期范围。') }
  const conditions = ['lifecycle_status=?', 'business_date BETWEEN ? AND ?']
  const values: (string | number | null)[] = [filters.lifecycle, start, end]
  if (filters.type === 'EXPENSE_FLOW') {
    conditions.push("entry_type IN ('EXPENSE','ADJUSTMENT')")
  } else if (filters.type !== 'ALL') {
    conditions.push('entry_type=?')
    values.push(filters.type)
  }
  for (const [key, column] of Object.entries(idFields)) {
    const id = filters[key as keyof typeof idFields]
    if (id !== undefined) {
      requireId(id, key)
      conditions.push(`${column}=?`)
      values.push(id)
    }
  }
  for (const [key, column] of Object.entries(absentFields)) {
    const missing = filters[key as keyof typeof absentFields]
    if (missing !== undefined && typeof missing !== 'boolean') throw fieldError(key, '请选择有效的缺失条件。')
    if (missing) conditions.push(`${column} IS NULL`)
  }
  if (filters.incomeName !== undefined) {
    if (typeof filters.incomeName !== 'string' || !filters.incomeName.trim() || unicodeCodePointLength(filters.incomeName) > 200) {
      throw fieldError('incomeName', '请选择有效的收入名称。')
    }
    conditions.push('income_name=?')
    values.push(filters.incomeName.trim())
  }
  if (filters.expenseWeekday !== undefined) {
    if (!Number.isInteger(filters.expenseWeekday) || filters.expenseWeekday < 1 || filters.expenseWeekday > 7) throw fieldError('expenseWeekday', '请选择有效星期。')
    conditions.push("((CAST(strftime('%w',business_date) AS INTEGER)+6)%7+1)=?")
    values.push(filters.expenseWeekday)
  }
  if (filters.expenseTimeBand !== undefined) {
    if (!Object.hasOwn(timeBands, filters.expenseTimeBand)) throw fieldError('expenseTimeBand', '请选择有效时段。')
    conditions.push("CAST(strftime('%H',business_time,'+8 hours') AS INTEGER) BETWEEN ? AND ?")
    values.push(...timeBands[filters.expenseTimeBand])
  }
  if (query) {
    // instr 为字面子串匹配；%、_、反斜线不作为 LIKE 通配符，也不拼入 SQL。
    conditions.push('instr(search_text,?)>0')
    values.push(query)
  }
  // 固定键序，等价条件不受调用方对象属性顺序影响；跨午夜边界重新加载，不能串页。
  const signature = JSON.stringify([start, end, ...Object.keys(filters).sort().map(key => [key, filters[key as keyof LedgerFilters]])])
  return { conditions, values, signature, start, end }
}

// 同一投影供有效明细、净支出构成和回收站消费；调整只冲减支出，不混成收入。
export const readbackProjection = `SELECT e.id,e.entry_type,e.business_time,e.business_date,e.amount_text,e.adjusted_text,e.linked_count,
  e.funding_channel_id,e.funding_channel_name_snapshot,e.note,COALESCE(e.created_at,'') AS created_at,e.row_version,e.lifecycle_status,e.deleted_at,e.purge_after,
  e.primary_category_id,e.secondary_category_id,e.product_id,e.unit_id,e.purchase_channel_id,e.location_label_id,
  e.income_category_id,e.payer_id,e.income_name,e.search_text,
  CASE WHEN e.entry_type='EXPENSE' THEN e.product_name_snapshot ELSE e.income_name END AS title,
  CASE WHEN e.entry_type='EXPENSE' THEN e.primary_category_name_snapshot || COALESCE(' / ' || e.secondary_category_name_snapshot,'') ELSE e.income_category_name_snapshot END AS category_name,
  CASE WHEN e.entry_type='EXPENSE' THEN COALESCE(e.quantity_text,'') || ' ' || COALESCE(e.unit_name_snapshot,'') ELSE e.payer_name_snapshot END AS counterparty_name,
  NULL AS adjustment_type,NULL AS original_expense_id,e.quantity_text,e.unit_name_snapshot FROM (${entryProjection}) e
  UNION ALL
  SELECT a.id,'ADJUSTMENT',a.business_time,a.business_date,CAST(a.amount_cents AS TEXT),'0',0,
  l.funding_channel_id,l.funding_channel_name_snapshot,a.note,a.created_at,a.row_version,
  CASE WHEN a.status='TRASHED' THEN 'TRASHED' ELSE 'ACTIVE' END,a.deleted_at,a.purge_after,
  l.primary_category_id,l.secondary_category_id,l.product_id,l.unit_id,l.purchase_channel_id,l.location_label_id,
  NULL,NULL,NULL,l.adjustment_source_search_text || ' ' || a.search_text,
  l.product_name_snapshot,
  CASE WHEN a.adjustment_type='REFUND' THEN '退款' ELSE '报销' END,l.product_name_snapshot,a.adjustment_type,a.original_expense_id,NULL,NULL
  FROM expense_adjustment a JOIN ledger_entry l ON l.id=a.original_expense_id
  WHERE a.status='TRASHED' OR (a.status='EFFECTIVE' AND l.lifecycle_status='ACTIVE')`
