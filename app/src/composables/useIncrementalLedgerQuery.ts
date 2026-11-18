import { ref } from 'vue'

import { listLedgerEntries, type LedgerFilters, type LedgerItem, type LedgerPage } from '../api/ledgerEntries'
import { useLatestRequest } from './useLatestRequest'

/** 复用统一请求代次与取消，并在稳定游标分页时按 ID 防御性去重。 */
export function useIncrementalLedgerQuery() {
  const items = ref<LedgerItem[]>([])
  const cursor = ref<string>()
  const hasMore = ref(false)
  const activeFilters = ref<LedgerFilters>()
  const lastOperation = ref<'replace' | 'refresh' | 'more'>('replace')
  let loadedPages = 1
  let generation = 0
  const loadingMore = ref(false)
  const request = useLatestRequest<LedgerPage>(() => {
    items.value = []
    cursor.value = undefined
    hasMore.value = false
    loadedPages = 1
  })

  async function replace(filters: LedgerFilters): Promise<void> {
    const current = ++generation
    lastOperation.value = 'replace'
    loadedPages = 1
    activeFilters.value = { ...filters }
    loadingMore.value = false
    items.value = []
    cursor.value = undefined
    hasMore.value = false
    const result = await request.execute((signal) => listLedgerEntries(filters, undefined, signal), {
      intent: 'replace', isEmpty: (page) => page.items.length === 0,
    })
    if (!result || current !== generation) return
    items.value = result.items
    cursor.value = result.nextCursor
    hasMore.value = result.hasMore
  }

  async function more(): Promise<void> {
    if (!activeFilters.value || !cursor.value || !hasMore.value || loadingMore.value || request.refreshing.value || request.status.value !== 'ready') return
    const current = ++generation
    lastOperation.value = 'more'
    loadingMore.value = true
    const result = await request.execute(
      (signal) => listLedgerEntries(activeFilters.value!, cursor.value, signal),
      { intent: 'silent' },
    )
    if (result && current === generation) {
      loadedPages += 1
      const known = new Set(items.value.map((item) => item.id))
      items.value = [...items.value, ...result.items.filter((item) => !known.has(item.id))]
      cursor.value = result.nextCursor
      hasMore.value = result.hasMore
    }
    if (current === generation) loadingMore.value = false
  }

  async function refresh(): Promise<void> {
    if (!activeFilters.value) return
    const current = ++generation
    lastOperation.value = 'refresh'
    const filters = { ...activeFilters.value }
    const pages = loadedPages
    let refreshedPages = 1
    loadingMore.value = false
    const result = await request.execute(async (signal) => {
      let page = await listLedgerEntries(filters, undefined, signal)
      const collected = [...page.items]
      // 仅刷新已经加载的深度，使用同一个取消信号，不在后台无限追页。
      for (let index = 1; index < pages && page.hasMore && page.nextCursor; index += 1) {
        page = await listLedgerEntries(filters, page.nextCursor, signal)
        collected.push(...page.items)
        refreshedPages += 1
      }
      return { ...page, items: [...new Map(collected.map((item) => [item.id, item])).values()] }
    }, { intent: 'silent', isEmpty: (page) => page.items.length === 0 })
    if (!result || current !== generation) return
    loadedPages = refreshedPages
    items.value = result.items
    cursor.value = result.nextCursor
    hasMore.value = result.hasMore
  }

  return {
    items, hasMore, loadingMore, replace, more, refresh, lastOperation,
    retry: () => lastOperation.value === 'refresh' ? refresh() : lastOperation.value === 'more' ? more()
      : activeFilters.value ? replace(activeFilters.value) : Promise.resolve(),
    status: request.status,
    error: request.error,
    staleWarning: request.staleWarning,
    refreshing: request.refreshing,
  }
}
