import { afterEach, describe, expect, it, vi } from 'vitest'

const { hooks, chart } = vi.hoisted(() => ({
  hooks: { mounted: [] as Array<() => void>, activated: [] as Array<() => void>,
    deactivated: [] as Array<() => void>, unmounted: [] as Array<() => void> },
  chart: { on: vi.fn(), setOption: vi.fn(), dispatchAction: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
}))
vi.mock('echarts/core', () => ({ use: vi.fn(), init: () => chart }))
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }))
vi.mock('vue', async (original) => ({
  ...await original<typeof import('vue')>(),
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
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('MutationObserver', Observer)
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  const state = useReportChart(() => ({ series: [] }))
  state.host.value = host as unknown as HTMLDivElement
  hooks.mounted.forEach((callback) => callback())
  chart.dispatchAction.mockClear()
  return { host, document, window }
}
afterEach(() => {
  hooks.unmounted.forEach((callback) => callback())
  Object.values(hooks).forEach((callbacks) => { callbacks.length = 0 })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('report tooltip lifecycle', () => {
  it('clears both tooltip and axis pointer when the pointer leaves or the content scrolls', () => {
    const { host, window } = setup()
    host.dispatchEvent(new Event('pointerleave'))
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' })
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: 'updateAxisPointer', currTrigger: 'leave' })
    chart.dispatchAction.mockClear()
    window.dispatchEvent(new Event('scroll'))
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' })
  })
  it('dismisses stale touch, outside focus and background tooltips', () => {
    const { host, document, window } = setup()
    host.dispatchEvent(Object.assign(new Event('pointerup'), { pointerType: 'mouse' }))
    expect(chart.dispatchAction).not.toHaveBeenCalled()
    host.dispatchEvent(Object.assign(new Event('pointerup'), { pointerType: 'touch' }))
    document.dispatchEvent(new Event('focusin'))
    window.dispatchEvent(new Event('blur'))
    expect(chart.dispatchAction.mock.calls.filter(([action]) => action.type === 'hideTip')).toHaveLength(3)
  })
  it('pauses interaction listeners for cached pages and reconnects once on return', async () => {
    const { host } = setup()
    hooks.deactivated.forEach((callback) => callback())
    chart.dispatchAction.mockClear()
    host.dispatchEvent(new Event('pointerleave'))
    expect(chart.dispatchAction).not.toHaveBeenCalled()
    hooks.activated.forEach((callback) => callback())
    await nextTick()
    chart.dispatchAction.mockClear()
    host.dispatchEvent(new Event('pointerleave'))
    expect(chart.dispatchAction.mock.calls.filter(([action]) => action.type === 'hideTip')).toHaveLength(1)
  })
})
