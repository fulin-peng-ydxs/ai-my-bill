<script setup lang="ts">
import { BarChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { use } from 'echarts/core'
import { computed, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

import type { components } from '../api/generated/schema'
import { formatCny } from '../domain/money'
import { useReportChart } from '../composables/useReportChart'

use([BarChart, GridComponent])

const props = defineProps<{
  title: string
  points: readonly components['schemas']['ReportDataPoint'][]
}>()

const emit = defineEmits<{ select: [point: components['schemas']['ReportDataPoint']] }>()
const cards = computed(() => props.points.map((point) => ({
  point,
  tone: point.value === 'EXPENSE' ? 'expense' : point.value === 'INCOME' || point.value === 'ADJUSTMENT' ? 'income' : 'neutral',
  sign: point.value === 'EXPENSE' ? '−' : point.value === 'INCOME' || point.value === 'ADJUSTMENT' ? '+' : '',
})))
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
    grid: { left: 8, right: 8, top: 32, bottom: 28, containLabel: true },
    xAxis: { type: 'category', data: props.points.map((point) => point.label), axisTick: { show: false },
      axisLabel: { color: muted }, axisLine: { lineStyle: { color: border } } },
    yAxis: { type: 'value', axisLabel: { color: muted, formatter: (value: number) => `¥${value}` },
      axisLine: { lineStyle: { color: border } }, splitLine: { lineStyle: { color: border, type: 'dashed' } } },
    series: [{
      type: 'bar', silent: true, label: { show: true, position: 'top', color: text, fontSize: 12, width: 100, overflow: 'truncate',
        formatter: (item: { dataIndex: number }) => formatCny(props.points[item.dataIndex].amount) }, data: props.points.map((point) => ({ value: Number(point.amount), itemStyle: { color: color(point.value) } })),
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
      <span>点击指标行查看明细</span>
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
        v-for="{ point, tone, sign } in cards"
        :key="point.value"
        type="button"
        :aria-label="`查看${point.label}明细，${point.itemCount}条`"
        @click="emit('select', point)"
      >
        <span>{{ point.label }}</span>
        <strong :class="`money-${tone}`">{{ sign }}{{ formatCny(point.amount) }}</strong>
        <small>{{ point.itemCount }} 条明细</small>
        <ChevronRight
          class="chart-action-indicator"
          :size="18"
          aria-hidden="true"
        />
      </button>
    </div>
  </section>
</template>
