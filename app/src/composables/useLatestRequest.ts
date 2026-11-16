import { onScopeDispose, ref, shallowRef } from 'vue'

import { normalizeRequestError, type RequestError } from '../api/errors'
import type { PageState } from '../app/pageRegistry'

// idle 只表示内部尚未请求或已取消；对外区域四态沿用页面登记的同一类型。
export type DataRegionStatus = PageState | 'idle'
export type RequestIntent = 'replace' | 'refresh' | 'silent'

export interface LatestRequestOptions<T> {
  intent?: RequestIntent
  isEmpty?: (value: T) => boolean
}

/**
 * 管理可切换查询的取消和单调代次。晚响应永不覆盖新条件；静默刷新网络失败标记过期，身份失效撤下旧结果及关联弹层。
 */
export function useLatestRequest<T>(onAccessDenied?: () => void) {
  const data = shallowRef<T>()
  const status = ref<DataRegionStatus>('idle')
  const error = shallowRef<RequestError>()
  const staleWarning = shallowRef<RequestError>()
  const refreshing = ref(false)
  let generation = 0
  let controller: AbortController | undefined
  let successfulStatus: 'ready' | 'empty' = 'ready'

  function cancel(): void {
    generation += 1
    controller?.abort()
    controller = undefined
    refreshing.value = false
    error.value = undefined
    if (status.value === 'loading') status.value = data.value === undefined ? 'idle' : successfulStatus
  }

  async function execute(
    request: (signal: AbortSignal) => Promise<T>,
    options: LatestRequestOptions<T> = {},
  ): Promise<T | undefined> {
    const intent = options.intent ?? 'replace'
    const requestGeneration = ++generation
    controller?.abort()
    controller = new AbortController()
    error.value = undefined
    staleWarning.value = undefined
    refreshing.value = data.value !== undefined && intent !== 'replace'
    if (intent === 'replace' || data.value === undefined) {
      data.value = undefined
      status.value = 'loading'
    } else {
      // 失败后的同条件重试也保留最后成功快照，不短暂落入空白错误区域。
      status.value = successfulStatus
    }

    try {
      const result = await request(controller.signal)
      if (requestGeneration !== generation) return undefined
      data.value = result
      successfulStatus = options.isEmpty?.(result) ? 'empty' : 'ready'
      status.value = successfulStatus
      return result
    } catch (cause) {
      if (requestGeneration !== generation) return undefined
      const normalized = normalizeRequestError(cause)
      if (normalized.kind === 'canceled') {
        status.value = data.value === undefined ? 'idle' : successfulStatus
        return undefined
      }
      // 身份或权限失效时，任何刷新方式都必须撤下旧数据。
      if (normalized.kind === 'unauthorized' || normalized.kind === 'forbidden') {
        data.value = undefined
        error.value = normalized
        status.value = 'error'
        onAccessDenied?.()
      } else if (intent === 'silent' && data.value !== undefined) {
        staleWarning.value = normalized
        status.value = options.isEmpty ? options.isEmpty(data.value) ? 'empty' : 'ready' : successfulStatus
      } else {
        error.value = normalized
        status.value = 'error'
      }
      return undefined
    } finally {
      if (requestGeneration === generation) {
        controller = undefined
        refreshing.value = false
      }
    }
  }

  onScopeDispose(cancel)
  return { data, status, error, staleWarning, refreshing, execute, cancel }
}
