import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, h, KeepAlive, nextTick, ref } from 'vue'
import { useDelayedLoading } from './useDelayedLoading'
import { pageActivityKey } from './usePageActivity'
import { renderer } from '../test/lifecycleRenderer'

const cleanups: (() => void)[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanups.splice(0).reverse().forEach(stop => stop()); vi.useRealTimers() })

function setup(pending = ref(false), immediate = ref(false)) {
  const scope = effectScope()
  const visible = scope.run(() => useDelayedLoading(pending, immediate))!
  cleanups.push(() => scope.stop())
  return { pending, immediate, visible, scope }
}

describe('read loading feedback', () => {
  it('never flashes for fast responses and shows a slow read only after 500ms', () => {
    const { pending, visible } = setup()
    pending.value = true
    vi.advanceTimersByTime(499)
    expect(visible.value).toBe(false)
    pending.value = false
    vi.advanceTimersByTime(1)
    expect(visible.value).toBe(false)
    pending.value = true
    vi.advanceTimersByTime(500)
    expect(visible.value).toBe(true)
    pending.value = false
    expect(visible.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels old deadlines across retries, completion and scope disposal', () => {
    const { pending, visible, scope } = setup(ref(true))
    vi.advanceTimersByTime(400)
    pending.value = false
    pending.value = true
    vi.advanceTimersByTime(100)
    expect(visible.value).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(500)
    expect(visible.value).toBe(false)
  })

  it('keeps mutation feedback immediate without creating a timer', () => {
    const { pending, visible } = setup(ref(true), ref(true))
    expect(visible.value).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    pending.value = false
    expect(visible.value).toBe(false)
  })

  it('resets feedback on both nested KeepAlive switches and page suspension', async () => {
    const shown = ref(true), pageActive = ref(true), pending = ref(true)
    let visible!: ReturnType<typeof useDelayedLoading>
    const child = { setup() { visible = useDelayedLoading(pending); return () => h('span') } }
    const app = renderer.createApp({ setup: () => () => h(KeepAlive, {}, { default: () => shown.value ? h(child) : h('div') }) })
    app.provide(pageActivityKey, pageActive)
    app.mount({ children: [] })
    cleanups.push(() => app.unmount())
    vi.advanceTimersByTime(400)
    shown.value = false
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(visible.value).toBe(false)
    shown.value = true
    await nextTick()
    vi.advanceTimersByTime(500)
    expect(visible.value).toBe(true)
    pageActive.value = false
    expect(visible.value).toBe(false)
    pageActive.value = true
    vi.advanceTimersByTime(499)
    expect(visible.value).toBe(false)
    pending.value = false
    expect(vi.getTimerCount()).toBe(0)
  })
})
