<script setup lang="ts">
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { use } from 'echarts/core'
import { watch } from 'vue'

import type { components } from '../api/generated/schema'
import { formatCny } from '../domain/money'
import { useReportChart } from '../composables/useReportChart'

use([BarChart, GridComponent, TooltipComponent])

const props = defineProps<{
  title: string
  points: readonly components['schemas']['ReportDataPoint'][]
}>()

const emit = defineEmits<{ select: [point: components['schemas']['ReportDataPoint']] }>()
function color(value: string): string {
  if (value === 'INCOME') return token('--color-income-accent')
  if (value === 'EXPENSE') return token('--color-expense-accent')
  return token('--color-warning')
}

const { host, token, refresh } = useReportChart(() => {
  const text = token('--color-text')
  const muted = token('--color-muted')
  const border = token('--color-border')
  return {
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
  }
})

watch(() => props.points, refresh, { deep: true })
</script>

<template>
  <section
    class="chart-panel"
    :aria-label="title"
  >
    <header>
      <div>
        <h2 class="section-title">
          {{ title }}
        </h2>
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
