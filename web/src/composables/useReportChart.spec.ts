import { afterEach, describe, expect, it, vi } from 'vitest'

const { hooks, chart } = vi.hoisted(() => ({
  hooks: { mounted: [] as Array<() => void>, activated: [] as Array<() => void>,
    deactivated: [] as Array<() => void>, unmounted: [] as Array<() => void> },
  chart: { on: vi.fn(), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
}))
vi.mock('./reportChartRuntime', () => ({ init: vi.fn(() => chart) }))
vi.mock('vue', async (original) => ({
  ...await original<typeof import('vue')>(),
  inject: (_key: unknown, fallback: unknown) => fallback,
  onMounted: (callback: () => void) => hooks.mounted.push(callback),
  onActivated: (callback: () => void) => hooks.activated.push(callback),
  onDeactivated: (callback: () => void) => hooks.deactivated.push(callback),
  onBeforeUnmount: (callback: () => void) => hooks.unmounted.push(callback),
}))
import { nextTick } from 'vue'
import { useReportChart } from './useReportChart'

function setup() {
  const host = Object.assign(new EventTarget(), { clientWidth: 390, clientHeight: 240, contains: (node: unknown) => node === host })
  const document = Object.assign(new EventTarget(), { documentElement: {} })
  const window = new EventTarget()
  class Observer { observe = vi.fn(); disconnect = vi.fn() }
  let notifyResize: () => void = () => undefined
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class extends Observer {
    constructor(callback: () => void) { super(); notifyResize = callback }
  })
  vi.stubGlobal('MutationObserver', Observer)
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '180ms' }))
  const state = useReportChart(() => ({ series: [], tooltip: { show: true } }))
  state.host.value = host as unknown as HTMLDivElement
  hooks.mounted.forEach((callback) => callback())
  return { host, document, window, state, frames,
    notifyResize: () => notifyResize(),
    flushFrames: () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(0))
    } }
}
afterEach(() => {
  hooks.unmounted.forEach((callback) => callback())
  Object.values(hooks).forEach((callbacks) => { callbacks.length = 0 })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('report chart lifecycle', () => {
  it('coalesces resize notifications outside the observer callback and skips zero-sized hosts', async () => {
    const { notifyResize, flushFrames, frames, host } = setup()
    await vi.dynamicImportSettled()
    notifyResize()
    notifyResize()
    expect(chart.resize).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    flushFrames()
    expect(chart.resize).toHaveBeenCalledOnce()
    host.clientHeight = 0
    notifyResize()
    flushFrames()
    expect(chart.resize).toHaveBeenCalledOnce()
  })
  it('cancels pending resize work on hiding, replacing the host and unmounting', async () => {
    const { notifyResize, flushFrames, frames, state } = setup()
    await vi.dynamicImportSettled()
    notifyResize()
    hooks.deactivated.forEach(callback => callback())
    expect(frames.size).toBe(0)
    notifyResize()
    expect(frames.size).toBe(0)
    hooks.activated.forEach(callback => callback())
    await nextTick()
    chart.resize.mockClear()
    notifyResize()
    state.host.value = Object.assign(new EventTarget(), { clientWidth: 430, clientHeight: 360 }) as unknown as HTMLDivElement
    await nextTick()
    expect(frames.size).toBe(0)
    notifyResize()
    hooks.unmounted.forEach(callback => callback())
    expect(frames.size).toBe(0)
    flushFrames()
    expect(chart.resize).not.toHaveBeenCalled()
  })
  it('reads current shared typography tokens for chart numbers instead of caching a local size', () => {
    const { state } = setup()
    const tokens: Record<string, string> = {
      '--font-data': 'ui-monospace, monospace',
      '--font-number-caption-size': '12px',
      '--font-number-caption-line': '18px',
    }
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => tokens[name] ?? '' }))
    expect(state.numberLabelStyle()).toEqual({
      fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 18, fontWeight: 400,
    })
    tokens['--font-number-caption-size'] = '14px'
    tokens['--font-number-caption-line'] = '20px'
    expect(state.numberLabelStyle()).toMatchObject({ fontSize: 14, lineHeight: 20 })
  })
  it('keeps readings fixed and provides no click-to-drill handler in the chart', async () => {
    setup()
    await vi.dynamicImportSettled()
    expect(chart.setOption).toHaveBeenCalledWith(expect.objectContaining({ series: [], animation: true, animationDuration: 180, animationDurationUpdate: 180 }), true)
    expect(chart.setOption.mock.calls[0]![0]).not.toHaveProperty('tooltip')
    expect(chart.on).not.toHaveBeenCalled()
  })
  it('does not redraw a cached hidden page and redraws on return', async () => {
    setup()
    await vi.dynamicImportSettled()
    hooks.deactivated.forEach((callback) => callback())
    chart.setOption.mockClear()
    hooks.activated.forEach((callback) => callback())
    hooks.deactivated.forEach((callback) => callback())
    await nextTick()
    expect(chart.setOption).not.toHaveBeenCalled()
    hooks.activated.forEach((callback) => callback())
    await nextTick()
    expect(chart.setOption).toHaveBeenCalledTimes(1)
    expect(chart.resize).toHaveBeenCalledTimes(1)
    expect(chart.setOption).toHaveBeenLastCalledWith(expect.objectContaining({ animation: false, animationDurationUpdate: 0 }), true)
  })
  it('reconnects a chart when an empty ranking creates a new container', async () => {
    const { state } = setup()
    await vi.dynamicImportSettled()
    chart.dispose.mockClear()
    state.host.value = undefined
    await nextTick()
    expect(chart.dispose).toHaveBeenCalledOnce()
    chart.setOption.mockClear()
    state.host.value = Object.assign(new EventTarget(), { clientWidth: 390, clientHeight: 240 }) as unknown as HTMLDivElement
    await nextTick()
    await vi.dynamicImportSettled()
    expect(chart.setOption).toHaveBeenCalledOnce()
  })
  it('ignores a pending runtime after unmount', async () => {
    vi.resetModules()
    const init = vi.fn(() => chart)
    let resolve!: (value: { init: typeof init }) => void
    vi.doMock('./reportChartRuntime', () => new Promise(done => { resolve = done }))
    const { useReportChart: delayedChart } = await import('./useReportChart')
    setup()
    const state = delayedChart(() => ({ series: [] }))
    state.host.value = Object.assign(new EventTarget(), { clientWidth: 390, clientHeight: 240 }) as unknown as HTMLDivElement
    hooks.mounted.at(-1)!()
    await vi.waitFor(() => expect(resolve).toBeDefined())
    hooks.unmounted.at(-1)!()
    resolve({ init })
    await vi.dynamicImportSettled()
    expect(init).not.toHaveBeenCalled()
  })
})
