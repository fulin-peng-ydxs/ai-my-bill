import { watch } from 'vue'

import { getDictionaryItem } from '../api/dictionaries'
import type { DictionaryType } from '../domain/dictionaries'
import { useLatestRequest } from './useLatestRequest'

export const dictionaryFilterTypes = {
  fundingChannelId: 'funding-channel', primaryCategoryId: 'expense-category', secondaryCategoryId: 'expense-category',
  productId: 'product', purchaseChannelId: 'purchase-channel', locationLabelId: 'location',
  incomeCategoryId: 'income-category', payerId: 'payer',
} as const satisfies Record<string, DictionaryType>
type Key = keyof typeof dictionaryFilterTypes

/** 只读取已应用的最多八个 ID；不为标签回显全量加载字典。 */
export function useDictionaryFilterLabels(filters: () => Partial<Record<Key, string>>) {
  const request = useLatestRequest<Partial<Record<Key, string>>>()
  watch(() => JSON.stringify(filters()), () => {
    const snapshot = filters()
    void request.execute(async (signal) => {
      const names: Partial<Record<Key, string>> = {}
      await Promise.all(Object.entries(dictionaryFilterTypes).map(async ([rawKey, type]) => {
        const key = rawKey as Key, id = snapshot[key]
        if (!id) return
        try { names[key] = (await getDictionaryItem(type, id, signal)).name }
        catch { /* 标签失败不改变稳定 ID 或放大筛选集合，页面展示语义回退文案。 */ }
      }))
      return names
    })
  }, { immediate: true })
  return (key: Key) => request.data.value?.[key]
}
