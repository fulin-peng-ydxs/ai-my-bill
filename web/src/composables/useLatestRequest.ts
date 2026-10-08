import { onScopeDispose, ref, shallowRef } from 'vue'

import { normalizeRequestError, type RequestError } from '../api/errors'

export type DataRegionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type RequestIntent = 'replace' | 'refresh' | 'silent'

export interface LatestRequestOptions<T> {
  intent?: RequestIntent
  isEmpty?: (value: T) => boolean
}

/**
 * 管理可切换查询的取消和单调代次。晚响应永不覆盖新条件；静默刷新失败时仅标记旧数据可能过期。
 */
export function useLatestRequest<T>() {
  const data = shallowRef<T>()
  const status = ref<DataRegionStatus>('idle')
  const error = shallowRef<RequestError>()
  const staleWarning = shallowRef<RequestError>()
  const refreshing = ref(false)
  let generation = 0
  let controller: AbortController | undefined

  function cancel(): void {
    generation += 1
    controller?.abort()
    controller = undefined
    refreshing.value = false
    error.value = undefined
    if (status.value === 'loading') status.value = data.value === undefined ? 'idle' : 'ready'
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
    }

    try {
      const result = await request(controller.signal)
      if (requestGeneration !== generation) return undefined
      data.value = result
      status.value = options.isEmpty?.(result) ? 'empty' : 'ready'
      return result
    } catch (cause) {
      if (requestGeneration !== generation) return undefined
      const normalized = normalizeRequestError(cause)
      if (normalized.kind === 'canceled') {
        status.value = data.value === undefined ? 'idle' : 'ready'
        return undefined
      }
      if (intent === 'silent' && data.value !== undefined) {
        staleWarning.value = normalized
        status.value = options.isEmpty?.(data.value) ? 'empty' : 'ready'
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
