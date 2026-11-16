import type { components } from '../../api/generated/schema'

// 迁移期保持原页面 DTO，运行期不经过旧 HTTP 客户端或身份上下文。
export type DictionaryType = components['schemas']['DictionaryType']
export type DictionaryItem = components['schemas']['DictionaryItem']
export type DictionaryPage = components['schemas']['DictionaryPage']
export type DictionaryStatus = components['schemas']['DictionaryStatus']
export type DictionarySummaries = components['schemas']['DictionarySummaries']
export type ProductMergePreview = components['schemas']['ProductMergePreview']
export type ProductMergeResult = components['schemas']['ProductMergeResult']
export type ProductSuggestion = components['schemas']['ProductSuggestion']

export const dictionaryKinds = {
  product: 'PRODUCT',
  'expense-category': 'EXPENSE_CATEGORY',
  unit: 'UNIT',
  'funding-channel': 'FUNDING_CHANNEL',
  'purchase-channel': 'PURCHASE_CHANNEL',
  location: 'LOCATION_LABEL',
  'income-category': 'INCOME_CATEGORY',
  payer: 'PAYER',
} as const satisfies Record<DictionaryType, string>
