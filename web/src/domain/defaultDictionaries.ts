import type { DefaultDictionaryType } from '../api/defaultDictionaries'

export interface DefaultDictionaryDefinition {
  type: DefaultDictionaryType
  label: string
  singular: string
  hierarchical: boolean
}

export const defaultDictionaryDefinitions = [
  { type: 'expense-category', label: '默认支出分类', singular: '分类', hierarchical: true },
  { type: 'income-category', label: '默认收入分类', singular: '收入分类', hierarchical: false },
  { type: 'unit', label: '默认单位', singular: '单位', hierarchical: false },
  { type: 'funding-channel', label: '默认资金渠道', singular: '资金渠道', hierarchical: false },
  { type: 'purchase-channel', label: '默认购买渠道', singular: '购买渠道', hierarchical: false },
] as const satisfies readonly DefaultDictionaryDefinition[]

export function defaultDictionaryDefinition(type: unknown): DefaultDictionaryDefinition {
  return defaultDictionaryDefinitions.find((item) => item.type === type) ?? defaultDictionaryDefinitions[0]
}
