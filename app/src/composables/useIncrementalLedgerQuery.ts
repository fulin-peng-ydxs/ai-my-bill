import { ref } from 'vue'

import { listLedgerEntries, type LedgerFilters, type LedgerItem, type LedgerPage } from '../api/ledgerEntries'
import { LocalError } from '../domain/localError'
import { useLatestRequest } from './useLatestRequest'

function isInvalidCursor(cause: unknown): cause is LocalError {
  return cause instanceof LocalError && cause.code === 'VALIDATION_FAILED' &&
    cause.fieldErrors.some(error => error.field === 'cursor')
}

/** 复用统一请求代次与取消，并在稳定游标分页时按 ID 防御性去重。 */
export function useIncrementalLedgerQuery() {
  const items = ref<LedgerItem[]>([])
  const cursor = ref<string>()
  const hasMore = ref(false)
  const activeFilters = ref<LedgerFilters>()
  const lastOperation = ref<'replace' | 'refresh' | 'more'>('replace')
  let loadedPages = 1
  let generation = 0
  let cursorNeedsRefresh = false
  const loadingMore = ref(false)
  const request = useLatestRequest<LedgerPage>(() => {
    items.value = []
    cursor.value = undefined
    hasMore.value = false
    loadedPages = 1
    cursorNeedsRefresh = false
  })

  async function replace(filters: LedgerFilters): Promise<void> {
    const current = ++generation
    lastOperation.value = 'replace'
    loadedPages = 1
    cursorNeedsRefresh = false
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
    if (cursorNeedsRefresh) return refresh()
    const current = ++generation
    const filters = { ...activeFilters.value }
    const nextCursor = cursor.value
    const previous = [...items.value]
    lastOperation.value = 'more'
    loadingMore.value = true
    const result = await request.execute(
      async (signal) => {
        const page = await listLedgerEntries(filters, nextCursor, signal)
        const known = new Set(previous.map(item => item.id))
        // 请求快照必须与累计列表一致；末页为空不能把已有明细的失败回显判为空。
        return { ...page, items: [...previous, ...page.items.filter(item => !known.has(item.id))] }
      },
      { intent: 'silent' },
    )
    if (current !== generation) return
    if (result) {
      loadedPages += 1
      items.value = result.items
      cursor.value = result.nextCursor
      hasMore.value = result.hasMore
    }
    loadingMore.value = false
    if (!result && isInvalidCursor(request.staleWarning.value?.cause)) {
      // 相对日期跨午夜等情况只自动重建一次，不循环重试已失效的游标。
      cursorNeedsRefresh = true
      await refresh()
    }
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
      try {
        let page = await listLedgerEntries(filters, undefined, signal)
        const collected = [...page.items]
        // 仅刷新已经加载的深度，使用同一个取消信号，不在后台无限追页。
        for (let index = 1; index < pages && page.hasMore && page.nextCursor; index += 1) {
          page = await listLedgerEntries(filters, page.nextCursor, signal)
          collected.push(...page.items)
          refreshedPages += 1
        }
        return { ...page, items: [...new Map(collected.map((item) => [item.id, item])).values()] }
      } catch (cause) {
        if (!isInvalidCursor(cause)) throw cause
        if (current === generation) cursorNeedsRefresh = true
        // 多页刷新自身跨过午夜时也保留现有重试入口；下一次仍从首批开始。
        throw new LocalError('LEDGER_QUERY_RELOAD_REQUIRED', '分页位置已变化，请重试重新加载明细。', {
          retryable: true, cause,
        })
      }
    }, { intent: 'silent', isEmpty: (page) => page.items.length === 0 })
    if (!result || current !== generation) return
    loadedPages = refreshedPages
    cursorNeedsRefresh = false
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
