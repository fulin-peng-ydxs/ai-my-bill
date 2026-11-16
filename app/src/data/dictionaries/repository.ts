import type { SqlSession } from '../ledgerDatabase'
import { LocalError } from '../../domain/localError'
import { dictionaryDisplayName, normalizedDictionaryName, unicodeCodePointLength } from '../../domain/text'
import { dictionaryKinds, type DictionaryItem, type DictionaryType } from './types'

export type DictionaryRow = Record<string, unknown> & {
  id: string
  name: string
  normalized_name: string
  status: 'ACTIVE' | 'INACTIVE'
  parent_id: string | null
  sort_order: number
}

/** 只有这份静态字段清单参与 SQL 组合，业务输入始终绑定参数。 */
const referenceFields = ['product_id', 'primary_category_id', 'secondary_category_id', 'unit_id',
  'funding_channel_id', 'purchase_channel_id', 'location_label_id', 'income_category_id', 'payer_id'] as const
const recentFields = ['merged_into_id', 'default_primary_category_id', 'default_secondary_category_id',
  'default_unit_id', 'last_funding_channel_id', 'last_purchase_channel_id'] as const
export const referencedSql = `(
  EXISTS(SELECT 1 FROM ledger_entry l WHERE ${referenceFields.map(field => `l.${field}=d.id`).join(' OR ')})
  OR EXISTS(SELECT 1 FROM daily_entry_template t WHERE ${referenceFields.map(field => `t.${field}=d.id`).join(' OR ')})
  OR EXISTS(SELECT 1 FROM product_details r WHERE ${recentFields.map(field => `r.${field}=d.id`).join(' OR ')})
  OR EXISTS(SELECT 1 FROM preference f WHERE f.key='defaultFundingChannelId' AND json_extract(f.value,'$')=d.id)
  OR EXISTS(SELECT 1 FROM product_merge_event e WHERE e.source_product_id=d.id OR e.target_product_id=d.id)
)`
export const dictionaryFromSql = `FROM dictionary_item d
  LEFT JOIN dictionary_item parent ON parent.id=d.parent_id
  LEFT JOIN product_details product ON product.product_id=d.id`
export const visibleSql = 'product.merged_into_id IS NULL'
export const dictionaryOrderSql = `COALESCE(parent.sort_order,d.sort_order), COALESCE(parent.id,d.id),
  CASE WHEN d.parent_id IS NULL THEN 0 ELSE 1 END, d.sort_order, d.id`

export function fieldError(field: string, message: string, code = 'VALIDATION_FAILED'): LocalError {
  return new LocalError(code, message, { fieldErrors: [{ field, message }] })
}

export function requireType(type: DictionaryType): string {
  if (!Object.hasOwn(dictionaryKinds, type)) {
    throw new LocalError('DICTIONARY_TYPE_NOT_FOUND', '字典类型不存在。')
  }
  return dictionaryKinds[type]
}

export function requireId(id: string, field = 'id'): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw fieldError(field, '字典标识不合法。')
  }
}

export function validateQuery(query: string): string {
  if (typeof query !== 'string' || unicodeCodePointLength(query) > 64) {
    throw fieldError('query', '搜索内容不能超过 64 个字符。')
  }
  return normalizedDictionaryName(query)
}

export function validateName(type: DictionaryType, value: string) {
  requireType(type)
  if (typeof value !== 'string') {
    throw fieldError('name', '请输入名称。')
  }
  const display = dictionaryDisplayName(value)
  const normalized = normalizedDictionaryName(display)
  const limit = type === 'product' ? 200 : 100
  const length = unicodeCodePointLength(display)
  if (!length || length > limit || !normalized) {
    throw fieldError('name', `名称长度必须为 1-${limit} 个字符。`)
  }
  return { display, normalized }
}

export function projectDictionary(type: DictionaryType, row: DictionaryRow): DictionaryItem {
  return {
    id: row.id,
    type,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
    ...(row.parent_id ? { parentId: row.parent_id, parentName: String(row.parent_name) } : {}),
    referenced: Boolean(row.referenced),
  }
}

export async function requireDictionary(sql: SqlSession, type: DictionaryType, id: string): Promise<DictionaryRow> {
  requireId(id)
  const rows = await sql.query(`SELECT d.*, parent.name AS parent_name, ${referencedSql} AS referenced
    ${dictionaryFromSql} WHERE d.kind=? AND d.id=? AND ${visibleSql}`, [requireType(type), id])
  if (!rows.length) {
    throw new LocalError('DICTIONARY_ITEM_NOT_FOUND', '字典项不存在。')
  }
  return rows[0] as DictionaryRow
}

export async function assertUniqueName(sql: SqlSession, kind: string, normalized: string, parentId: string | null, exceptId = '') {
  const duplicates = await sql.query('SELECT id FROM dictionary_item WHERE kind=? AND normalized_name=? AND parent_id IS ? AND id<>? LIMIT 1',
    [kind, normalized, parentId, exceptId])
  if (duplicates.length) {
    throw fieldError('name', '同一字典中已存在等价名称。', 'DICTIONARY_NAME_CONFLICT')
  }
}
