import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDebouncedQuery } from './useDebouncedQuery'

afterEach(() => vi.useRealTimers())

describe('useDebouncedQuery', () => {
  it('debounces typing while Enter and clear submit immediately', () => {
    vi.useFakeTimers()
    const query = vi.fn()
    const scope = effectScope()
    const debounced = scope.run(() => useDebouncedQuery(query, 250))!

    debounced.schedule('早')
    debounced.schedule('早餐')
    vi.advanceTimersByTime(249)
    expect(query).not.toHaveBeenCalled()
    debounced.submit('早餐')
    expect(query).toHaveBeenLastCalledWith('早餐')
    debounced.schedule('待清空')
    debounced.submit('')
    vi.runAllTimers()
    expect(query).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenLastCalledWith('')
    scope.stop()
  })

  it('cancels pending work when its Vue scope is disposed', () => {
    vi.useFakeTimers()
    const query = vi.fn()
    const scope = effectScope()
    scope.run(() => useDebouncedQuery(query).schedule('不会查询'))
    scope.stop()
    vi.runAllTimers()
    expect(query).not.toHaveBeenCalled()
  })
})
