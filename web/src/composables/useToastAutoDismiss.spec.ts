import { effectScope, nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToastAutoDismiss } from './useToastAutoDismiss'

const scopes: ReturnType<typeof effectScope>[] = []
function setup() {
  vi.useFakeTimers()
  const state = reactive({ open: false, message: '保存成功', kind: 'success' as 'success' | 'error',
    paused: false, active: true, notificationKey: 'first' })
  const dismiss = vi.fn(() => { state.open = false })
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useToastAutoDismiss(() => ({ ...state }), dismiss))
  return { state, dismiss, scope }
}
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})

describe('toast auto dismissal', () => {
  it('dismisses success after five seconds without requiring a close click', async () => {
    const { state, dismiss } = setup()
    state.open = true
    await nextTick()
    vi.advanceTimersByTime(4999)
    expect(dismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(state.open).toBe(false)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('gives a second save with the same message a full display interval', async () => {
    const { state, dismiss } = setup()
    state.open = true
    await nextTick()
    vi.advanceTimersByTime(4000)
    state.notificationKey = 'second'
    await nextTick()
    vi.advanceTimersByTime(4999)
    expect(dismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps errors visible and cancels a success timer when a retry fails', async () => {
    const { state, dismiss } = setup()
    state.open = true
    await nextTick()
    state.kind = 'error'
    state.message = '撤销失败，请重试'
    await nextTick()
    vi.advanceTimersByTime(60000)
    expect(state.open).toBe(true)
    expect(dismiss).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses while reading, focusing an action or waiting for undo, then resumes', async () => {
    const { state, dismiss } = setup()
    state.open = true
    await nextTick()
    vi.advanceTimersByTime(4000)
    state.paused = true
    await nextTick()
    vi.advanceTimersByTime(60000)
    expect(dismiss).not.toHaveBeenCalled()
    state.paused = false
    await nextTick()
    vi.advanceTimersByTime(5000)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('clears hidden-page feedback and does not replay it on return', async () => {
    const { state, dismiss } = setup()
    state.open = true
    await nextTick()
    state.active = false
    await nextTick()
    expect(state.open).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    state.active = true
    await nextTick()
    vi.advanceTimersByTime(60000)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('cancels timers on manual close and unmount', async () => {
    const { state, dismiss, scope } = setup()
    state.open = true
    await nextTick()
    state.open = false
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)
    state.open = true
    await nextTick()
    scope.stop()
    vi.advanceTimersByTime(60000)
    expect(dismiss).not.toHaveBeenCalled()
  })
})
