import type { LedgerContracts } from '../../domain/ledgerContracts'

// 迁移期保持原页面 DTO，运行期不经过旧 HTTP 客户端或身份上下文。
export type DictionaryType = LedgerContracts['DictionaryType']
export type DictionaryItem = LedgerContracts['DictionaryItem']
export type DictionaryPage = LedgerContracts['DictionaryPage']
export type DictionaryStatus = LedgerContracts['DictionaryStatus']
export type DictionarySummaries = LedgerContracts['DictionarySummaries']
export type ProductMergePreview = LedgerContracts['ProductMergePreview']
export type ProductMergeResult = LedgerContracts['ProductMergeResult']
export type ProductSuggestion = LedgerContracts['ProductSuggestion']

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
