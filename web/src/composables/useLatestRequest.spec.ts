import { effectScope } from 'vue'
import { describe, expect, it } from 'vitest'

import { useLatestRequest } from './useLatestRequest'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('useLatestRequest', () => {
  it('retains the successful empty state after a silent refresh failure', async () => {
    const scope = effectScope()
    const state = scope.run(() => useLatestRequest<string[]>())!
    const isEmpty = (items: string[]) => items.length === 0
    await state.execute(async () => [], { isEmpty })
    await state.execute(async () => { throw new TypeError('offline') }, { intent: 'silent', isEmpty })
    expect(state.status.value).toBe('empty')
    expect(state.data.value).toEqual([])
    expect(state.staleWarning.value?.kind).toBe('network')
    scope.stop()
  })

  it('drops a late response even when the request implementation ignores abort', async () => {
    const scope = effectScope()
    const state = scope.run(() => useLatestRequest<string[]>())!
    const old = deferred<string[]>()
    const current = deferred<string[]>()
    const oldRun = state.execute(() => old.promise)
    const currentRun = state.execute(() => current.promise)
    current.resolve(['当前条件'])
    await currentRun
    old.resolve(['过期条件'])
    await oldRun
    expect(state.data.value).toEqual(['当前条件'])
    expect(state.status.value).toBe('ready')
    scope.stop()
  })

  it('keeps valid data and exposes a stale warning after silent refresh failure', async () => {
    const scope = effectScope()
    const state = scope.run(() => useLatestRequest<string[]>())!
    await state.execute(async () => ['已有数据'])
    await state.execute(async () => { throw new TypeError('offline') }, { intent: 'silent' })
    expect(state.data.value).toEqual(['已有数据'])
    expect(state.status.value).toBe('ready')
    expect(state.staleWarning.value?.kind).toBe('network')
    scope.stop()
  })

  it('uses an area error for a user-triggered replacement and detects empty results', async () => {
    const scope = effectScope()
    const state = scope.run(() => useLatestRequest<string[]>())!
    await state.execute(async () => [], { isEmpty: (items) => items.length === 0 })
    expect(state.status.value).toBe('empty')
    await state.execute(async () => { throw new TypeError('offline') })
    expect(state.status.value).toBe('error')
    expect(state.error.value?.retryable).toBe(true)
    scope.stop()
  })

  it('returns to a neutral state when an active request is canceled', async () => {
    const scope = effectScope()
    const state = scope.run(() => useLatestRequest<string[]>())!
    const running = state.execute((signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    state.cancel()
    await running
    expect(state.status.value).toBe('idle')
    expect(state.error.value).toBeUndefined()
    scope.stop()
  })

  it('does not leave a region loading when the request source cancels itself', async () => {
    const scope = effectScope()
    const state = scope.run(() => useLatestRequest<string[]>())!

    await state.execute(async () => { throw new DOMException('aborted', 'AbortError') })
    expect(state.status.value).toBe('idle')
    await state.execute(async () => ['已有数据'])
    await state.execute(async () => { throw new DOMException('aborted', 'AbortError') }, { intent: 'silent' })
    expect(state.status.value).toBe('ready')
    expect(state.data.value).toEqual(['已有数据'])
    expect(state.error.value).toBeUndefined()
    scope.stop()
  })
})
