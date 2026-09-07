import { computed, ref } from 'vue'

import { listLedgerEntries, type LedgerFilters, type LedgerItem, type LedgerPage } from '../api/ledgerEntries'
import { useLatestRequest } from './useLatestRequest'

/** 复用统一请求代次与取消，并在稳定游标分页时按 ID 防御性去重。 */
export function useIncrementalLedgerQuery() {
  const request = useLatestRequest<LedgerPage>()
  const items = ref<LedgerItem[]>([])
  const cursor = ref<string>()
  const hasMore = ref(false)
  const activeFilters = ref<LedgerFilters>()
  const loadingMore = ref(false)

  async function replace(filters: LedgerFilters): Promise<void> {
    activeFilters.value = { ...filters }
    loadingMore.value = false
    const result = await request.execute((signal) => listLedgerEntries(filters, undefined, signal), {
      intent: 'replace', isEmpty: (page) => page.items.length === 0,
    })
    if (!result) return
    items.value = result.items
    cursor.value = result.nextCursor
    hasMore.value = result.hasMore
  }

  async function more(): Promise<void> {
    if (!activeFilters.value || !cursor.value || !hasMore.value || loadingMore.value) return
    loadingMore.value = true
    const result = await request.execute(
      (signal) => listLedgerEntries(activeFilters.value!, cursor.value, signal),
      { intent: 'silent' },
    )
    if (result) {
      const known = new Set(items.value.map((item) => item.id))
      items.value = [...items.value, ...result.items.filter((item) => !known.has(item.id))]
      cursor.value = result.nextCursor
      hasMore.value = result.hasMore
    }
    loadingMore.value = false
  }

  return {
    items, hasMore, loadingMore, replace, more,
    status: request.status,
    error: computed(() => request.error.value ?? request.staleWarning.value),
  }
}
