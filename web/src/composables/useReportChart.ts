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

  function token(name: string): string {
    return host.value ? globalThis.getComputedStyle(host.value).getPropertyValue(name).trim() : ''
  }
  function render(): void {
    if (!active || !host.value || host.value.clientWidth === 0 || host.value.clientHeight === 0) return
    if (!chart) {
      chart = init(host.value, undefined, { renderer: 'svg' })
      chart.on('click', (event) => { if (typeof event.dataIndex === 'number') onDataIndex?.(event.dataIndex) })
    }
    chart.setOption(option(), true)
  }
  function refresh(): void { void nextTick(render) }

  function connect(): void {
    resizeObserver?.disconnect()
    themeObserver?.disconnect()
    const element = host.value
    if (!element) return
    render()
    resizeObserver = new ResizeObserver(() => { if (active) { if (chart) chart.resize(); else render() } })
    resizeObserver.observe(element)
    themeObserver = new MutationObserver(render)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  }
  onMounted(connect)
  onActivated(() => { active = true; void nextTick(() => { if (!active) return; connect(); chart?.resize() }) })
  onDeactivated(() => { active = false; resizeObserver?.disconnect(); themeObserver?.disconnect() })
  onBeforeUnmount(() => { active = false; resizeObserver?.disconnect(); themeObserver?.disconnect(); chart?.dispose() })
  return { host, token, refresh }
}
