import { init, type ECharts, type EChartsCoreOption } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { use } from 'echarts/core'

use([SVGRenderer])

export function useReportChart(option: () => EChartsCoreOption, onDataIndex?: (index: number) => void) {
  const host = ref<HTMLDivElement>()
  let chart: ECharts | undefined
  let resizeObserver: ResizeObserver | undefined
  let themeObserver: MutationObserver | undefined

  function token(name: string): string {
    return host.value ? globalThis.getComputedStyle(host.value).getPropertyValue(name).trim() : ''
  }
  function render(): void {
    if (!host.value || host.value.clientWidth === 0 || host.value.clientHeight === 0) return
    if (!chart) {
      chart = init(host.value, undefined, { renderer: 'svg' })
      chart.on('click', (event) => { if (typeof event.dataIndex === 'number') onDataIndex?.(event.dataIndex) })
    }
    chart.setOption(option(), true)
  }
  function refresh(): void { void nextTick(render) }

  onMounted(() => {
    const element = host.value
    if (!element) return
    render()
    resizeObserver = new ResizeObserver(() => chart ? chart.resize() : render())
    resizeObserver.observe(element)
    themeObserver = new MutationObserver(render)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  })
  onBeforeUnmount(() => { resizeObserver?.disconnect(); themeObserver?.disconnect(); chart?.dispose() })
  return { host, token, refresh }
}
