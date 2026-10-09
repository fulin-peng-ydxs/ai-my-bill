import { afterEach, describe, expect, it, vi } from 'vitest'

const { hooks, chart } = vi.hoisted(() => ({
  hooks: { mounted: [] as Array<() => void>, activated: [] as Array<() => void>,
    deactivated: [] as Array<() => void>, unmounted: [] as Array<() => void> },
  chart: { on: vi.fn(), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
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
  const state = useReportChart(() => ({ series: [], tooltip: { show: true } }))
  state.host.value = host as unknown as HTMLDivElement
  hooks.mounted.forEach((callback) => callback())
  return { host, document, window }
}
afterEach(() => {
  hooks.unmounted.forEach((callback) => callback())
  Object.values(hooks).forEach((callbacks) => { callbacks.length = 0 })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('report chart lifecycle', () => {
  it('keeps readings fixed and provides no click-to-drill handler in the chart', () => {
    setup()
    expect(chart.setOption).toHaveBeenCalledWith({ series: [] }, true)
    expect(chart.on).not.toHaveBeenCalled()
  })
  it('does not redraw a cached hidden page and redraws on return', async () => {
    setup()
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
  })
})
