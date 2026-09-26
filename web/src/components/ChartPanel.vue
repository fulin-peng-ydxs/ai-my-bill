<script setup lang="ts">
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { components } from '../api/generated/schema'
import { formatCny } from '../domain/money'

use([BarChart, GridComponent, TooltipComponent, SVGRenderer])

const props = defineProps<{
  title: string
  points: readonly components['schemas']['ReportDataPoint'][]
}>()

const emit = defineEmits<{ select: [point: components['schemas']['ReportDataPoint']] }>()
const host = ref<globalThis.HTMLDivElement>()
let chart: ECharts | undefined
let resizeObserver: InstanceType<typeof globalThis.ResizeObserver> | undefined
let themeObserver: InstanceType<typeof globalThis.MutationObserver> | undefined

function token(name: string): string {
  return host.value ? globalThis.getComputedStyle(host.value).getPropertyValue(name).trim() : ''
}

function color(value: string): string {
  if (value === 'INCOME') return token('--color-income-accent')
  if (value === 'EXPENSE') return token('--color-expense-accent')
  return token('--color-warning')
}

function render(): void {
  if (!host.value) return
  chart ??= init(host.value, undefined, { renderer: 'svg' })
  const text = token('--color-text')
  const muted = token('--color-muted')
  const border = token('--color-border')
  chart.setOption({
    animationDuration: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
    textStyle: { color: text },
    grid: { left: 8, right: 8, top: 8, bottom: 28, containLabel: true },
    xAxis: { type: 'category', data: props.points.map((point) => point.label), axisTick: { show: false },
      axisLabel: { color: muted }, axisLine: { lineStyle: { color: border } } },
    yAxis: { type: 'value', axisLabel: { color: muted, formatter: (value: number) => `¥${value}` },
      axisLine: { lineStyle: { color: border } }, splitLine: { lineStyle: { color: border, type: 'dashed' } } },
    tooltip: { trigger: 'axis', backgroundColor: token('--color-surface'), borderColor: border,
      textStyle: { color: text }, valueFormatter: (value: unknown) => formatCny(String(value)) },
    series: [{
      type: 'bar', data: props.points.map((point) => ({ value: Number(point.amount), itemStyle: { color: color(point.value) } })),
      barMaxWidth: 64,
    }],
  }, true)
}

watch(() => props.points, () => { void nextTick(render) }, { deep: true })

onMounted(() => {
  render()
  resizeObserver = new globalThis.ResizeObserver(() => chart?.resize())
  resizeObserver.observe(host.value!)
  themeObserver = new globalThis.MutationObserver(render)
  themeObserver.observe(globalThis.document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <section
    class="chart-panel"
    :aria-label="title"
  >
    <header>
      <div>
        <p class="eyebrow">
          统一口径
        </p>
        <h2>{{ title }}</h2>
      </div>
      <span>点击指标查看明细</span>
    </header>
    <div
      ref="host"
      class="chart-canvas"
      aria-hidden="true"
    />
    <div
      class="chart-actions"
      aria-label="可下钻指标"
    >
      <button
        v-for="point in points"
        :key="point.value"
        type="button"
        @click="emit('select', point)"
      >
        <span>{{ point.label }}</span>
        <strong>{{ formatCny(point.amount) }}</strong>
        <small>{{ point.itemCount }} 条 · 查看明细</small>
      </button>
    </div>
  </section>
</template>
