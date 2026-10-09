import { init, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { use } from 'echarts/core'

use([SVGRenderer])

export function useReportChart(option: () => EChartsCoreOption, onDataIndex?: (index: number) => void) {
  const host = ref<HTMLDivElement>()
  let active = true
  let chart: ECharts | undefined
  let resizeObserver: ResizeObserver | undefined
  let themeObserver: MutationObserver | undefined
  let disconnectInteractions: (() => void) | undefined

  function hideTip(): void {
    chart?.dispatchAction({ type: 'hideTip' })
    chart?.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' })
  }

  function outside(event: Event): void {
    if (!host.value?.contains(event.target as Node)) hideTip()
  }
  function touchEnd(event: PointerEvent): void { if (event.pointerType !== 'mouse') hideTip() }
  function escape(event: KeyboardEvent): void { if (event.key === 'Escape') hideTip() }

  function token(name: string): string {
    return host.value ? globalThis.getComputedStyle(host.value).getPropertyValue(name).trim() : ''
  }
  function render(): void {
    if (!active || !host.value || host.value.clientWidth === 0 || host.value.clientHeight === 0) return
    if (!chart) {
      chart = init(host.value, undefined, { renderer: 'svg' })
      chart.on('click', (event) => { if (typeof event.dataIndex === 'number') onDataIndex?.(event.dataIndex) })
    }
    hideTip()
    chart.setOption(option(), true)
  }
  function refresh(): void { void nextTick(render) }

  function connect(): void {
    disconnectInteractions?.()
    resizeObserver?.disconnect()
    themeObserver?.disconnect()
    const element = host.value
    if (!element) return
    render()
    resizeObserver = new ResizeObserver(() => { if (active) { hideTip(); if (chart) chart.resize(); else render() } })
    resizeObserver.observe(element)
    themeObserver = new MutationObserver(render)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    element.addEventListener('pointerleave', hideTip)
    element.addEventListener('pointerup', touchEnd)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    document.addEventListener('keydown', escape)
    document.addEventListener('visibilitychange', hideTip)
    window.addEventListener('blur', hideTip)
    window.addEventListener('scroll', hideTip, true)
    disconnectInteractions = () => {
      element.removeEventListener('pointerleave', hideTip)
      element.removeEventListener('pointerup', touchEnd)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('visibilitychange', hideTip)
      window.removeEventListener('blur', hideTip)
      window.removeEventListener('scroll', hideTip, true)
    }
  }
  onMounted(connect)
  onActivated(() => { active = true; void nextTick(() => { if (!active) return; connect(); chart?.resize() }) })
  function suspend(): void {
    active = false
    hideTip()
    disconnectInteractions?.()
    resizeObserver?.disconnect()
    themeObserver?.disconnect()
  }
  onDeactivated(suspend)
  onBeforeUnmount(() => { suspend(); chart?.dispose() })
  return { host, token, refresh }
}
