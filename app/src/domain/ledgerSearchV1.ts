import { normalizedDictionaryName } from './dictionaryNameV1'

// v7 数据步骤摘要包含本文件；变更规范化规则须新增版本，不能修改历史算法。
const entryFields = ['product_name_snapshot', 'primary_category_name_snapshot', 'secondary_category_name_snapshot',
  'income_name', 'payer_name_snapshot', 'income_category_name_snapshot', 'funding_channel_name_snapshot',
  'purchase_channel_name_snapshot', 'location_label_name_snapshot', 'note'] as const
const sourceFields = ['product_name_snapshot', 'primary_category_name_snapshot', 'secondary_category_name_snapshot',
  'funding_channel_name_snapshot'] as const
function joined(row: Record<string, unknown>, fields: readonly string[]): string {
  return normalizedDictionaryName(fields.map(field => row[field] ?? '').join(' '))
}
/** 只消费历史快照；字典改名、停用或合并不会改写历史搜索文案。 */
export const entrySearchText = (row: Record<string, unknown>) => joined(row, entryFields)
export const adjustmentSourceSearchText = (row: Record<string, unknown>) => joined(row, sourceFields)
export const adjustmentSearchText = (row: Record<string, unknown>) => normalizedDictionaryName(
  `${row.adjustment_type === 'REFUND' ? '退款' : '报销'} ${row.note ?? ''}`)
