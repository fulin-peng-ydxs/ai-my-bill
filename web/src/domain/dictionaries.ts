import type { components } from '../api/generated/schema'

export type DictionaryType = components['schemas']['DictionaryType']

export interface DictionaryDefinition {
  type: DictionaryType
  label: string
  singular: string
  description: string
  hierarchical: boolean
  actionName: string
}

export const dictionaryDefinitions = [
  { type: 'product', label: '商品', singular: '商品', description: '记账时使用的商品名称。', hierarchical: false, actionName: '商品' },
  { type: 'expense-category', label: '支出分类', singular: '分类', description: '最多两级，用于整理每笔支出。', hierarchical: true, actionName: '支出分类' },
  { type: 'unit', label: '单位', singular: '单位', description: '商品数量对应的计量单位。', hierarchical: false, actionName: '单位' },
  { type: 'funding-channel', label: '资金渠道', singular: '资金渠道', description: '支出显示为支付方式，收入显示为收款方式。', hierarchical: false, actionName: '资金渠道' },
  { type: 'purchase-channel', label: '购买渠道', singular: '购买渠道', description: '记录购买发生的平台或渠道。', hierarchical: false, actionName: '购买渠道' },
  { type: 'location', label: '常用地点', singular: '地点标签', description: '只记录文本标签，不读取位置或坐标。', hierarchical: false, actionName: '常用地点' },
  { type: 'income-category', label: '收入分类', singular: '收入分类', description: '用于归类收入；收入名称仍在记账时填写。', hierarchical: false, actionName: '收入分类' },
  { type: 'payer', label: '付款方', singular: '付款方', description: '记录收入来源的付款方。', hierarchical: false, actionName: '付款方' },
] as const satisfies readonly DictionaryDefinition[]

export function dictionaryDefinition(type: unknown): DictionaryDefinition | undefined {
  return dictionaryDefinitions.find((item) => item.type === type)
}

/** 与服务端唯一键规则一致，用于在提交前识别等价字典名称。 */
export function normalizeDictionaryName(value: string): string {
  return value.normalize('NFKC').trim().replace(/[\p{Z}\s]+/gu, ' ').toLowerCase()
}
