import type { ECharts, EChartsCoreOption } from 'echarts/core'
import { inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useMotionPreference } from './useMotionPreference'
import { pageMotionKey } from './useContentMotion'
import { motionMilliseconds } from './motion'

let runtime: Promise<typeof import('./reportChartRuntime')> | undefined
function loadRuntime() {
  // 同时挂载的图表共用一次加载；失败可重试，不缓存 rejected Promise。
  return runtime ??= import('./reportChartRuntime').catch(cause => { runtime = undefined; throw cause })
}

export function useReportChart(option: () => EChartsCoreOption) {
  const host = ref<HTMLDivElement>()
  const failed = ref(false)
  const reduced = useMotionPreference()
  const pageEntering = inject(pageMotionKey, undefined)
  let active = true
  let mounted = false
  let disposed = false
  let loading = false
  let chart: ECharts | undefined
  let resizeObserver: ResizeObserver | undefined
  let themeObserver: MutationObserver | undefined
  let resizeFrame: number | undefined
  function token(name: string): string {
    return host.value ? globalThis.getComputedStyle(host.value).getPropertyValue(name).trim() : ''
  }
  // ECharts 的数字标签和数值坐标轴消费与页面辅助数字相同的字体 token。
  function numberLabelStyle() {
    return {
      fontFamily: token('--font-data'),
      fontSize: Number.parseFloat(token('--font-number-caption-size')),
      lineHeight: Number.parseFloat(token('--font-number-caption-line')),
      fontWeight: 400,
    }
  }
  function render(animate = false): void {
    if (!active || !host.value || host.value.clientWidth === 0 || host.value.clientHeight === 0) return
    if (!chart) {
      if (loading || disposed) return
      loading = true
      failed.value = false
      const animateWhenLoaded = animate && !pageEntering?.value
      void loadRuntime().then(({ init }) => {
        if (!active || disposed || !host.value || !host.value.clientWidth || !host.value.clientHeight) return
        chart = init(host.value, undefined, { renderer: 'svg' })
        // 加载期间条件可能改变，始终读取当前 option 和系统动效偏好。
        render(animateWhenLoaded)
      }).catch(() => { if (active && !disposed) failed.value = true }).finally(() => { loading = false })
      return
    }
    // 图表仅呈现趋势；固定读数与明确的明细入口承担查看，滚动不会触发下钻。
    const chartOption = { ...option() }
    delete chartOption.tooltip
    const duration = animate && !reduced.value && !pageEntering?.value && !document.hidden
      ? motionMilliseconds(host.value, '--motion-standard') : 0
    chartOption.animation = duration > 0
    chartOption.animationDuration = duration
    chartOption.animationDurationUpdate = duration
    chartOption.animationEasing = 'cubicOut'
    chartOption.animationEasingUpdate = 'cubicOut'
    chart.setOption(chartOption, true)
  }
  function refresh(): void { void nextTick(() => render(true)) }
  watch(reduced, () => render())

  function cancelResize(): void {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeFrame = undefined
  }
  function scheduleResize(): void {
    if (!active || resizeFrame !== undefined) return
    // SVG 尺寸更新会写回布局；离开观察器通知阶段，避免同帧循环并合并连续尺寸变化。
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      if (!active || !host.value?.clientWidth || !host.value.clientHeight) return
      if (chart) chart.resize()
      else render()
    })
  }
  function connect(): void {
    cancelResize()
    resizeObserver?.disconnect()
    themeObserver?.disconnect()
    const element = host.value
    if (!element) return
    render(!chart)
    resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(element)
    themeObserver = new MutationObserver(() => render())
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  }
  onMounted(() => { mounted = true; connect() })
  // 排行从空结果/质量线索切回图表时，容器可能被重新创建，不能继续写入旧 SVG。
  watch(host, (element, previous) => {
    if (!mounted || element === previous) return
    cancelResize()
    resizeObserver?.disconnect()
    themeObserver?.disconnect()
    chart?.dispose()
    chart = undefined
    if (active && element) connect()
  }, { flush: 'post' })
  onActivated(() => { active = true; void nextTick(() => { if (!active) return; connect(); chart?.resize() }) })
  function suspend(): void {
    active = false
    cancelResize()
    resizeObserver?.disconnect()
    themeObserver?.disconnect()
  }
  onDeactivated(suspend)
  onBeforeUnmount(() => { disposed = true; suspend(); chart?.dispose() })
  return { host, token, numberLabelStyle, refresh, failed }
}
