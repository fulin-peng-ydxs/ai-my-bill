<script setup lang="ts">
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent } from 'echarts/components'
import { use } from 'echarts/core'
import { computed, ref, watch } from 'vue'

import type { ReportTimeMetric, TimeReport } from '../api/reports'
import { useReportChart } from '../composables/useReportChart'
import { formatCny } from '../domain/money'

use([LineChart, GridComponent, LegendComponent])
type Bucket = TimeReport['buckets'][number]
type AmountKey = 'totalIncome' | 'grossExpense' | 'adjustmentAmount' | 'netExpense' | 'balance'
  | 'cumulativeIncome' | 'cumulativeGrossExpense' | 'cumulativeAdjustmentAmount' | 'cumulativeNetExpense' | 'cumulativeBalance'
const DEFINITIONS: Record<ReportTimeMetric, { label: string, field: AmountKey, cumulative: AmountKey, color: string }> = {
  TOTAL_INCOME: { label: '总收入', field: 'totalIncome', cumulative: 'cumulativeIncome', color: '--color-income-accent' },
  GROSS_EXPENSE: { label: '原始支出', field: 'grossExpense', cumulative: 'cumulativeGrossExpense', color: '--color-expense-accent' },
  ADJUSTMENT: { label: '退款/报销冲减', field: 'adjustmentAmount', cumulative: 'cumulativeAdjustmentAmount', color: '--color-income-accent' },
  NET_EXPENSE: { label: '净支出', field: 'netExpense', cumulative: 'cumulativeNetExpense', color: '--color-expense-accent' },
  BALANCE: { label: '结余', field: 'balance', cumulative: 'cumulativeBalance', color: '--color-warning' },
}
const props = defineProps<{ report: TimeReport, metric: ReportTimeMetric }>()
const emit = defineEmits<{ select: [bucket: Bucket] }>()
const selected = ref(0)
const selectedBucket = computed(() => props.report.buckets[selected.value])
const definition = computed(() => DEFINITIONS[props.metric])
const comparison = computed(() => props.report.comparisons.find((item) => item.metric === props.metric))
function metricCount(bucket: Bucket): number {
  if (props.metric === 'TOTAL_INCOME') return bucket.incomeCount
  if (props.metric === 'GROSS_EXPENSE') return bucket.expenseCount
  if (props.metric === 'ADJUSTMENT') return bucket.adjustmentCount
  if (props.metric === 'NET_EXPENSE') return bucket.expenseCount + bucket.adjustmentCount
  return bucket.itemCount
}
const { host, token, refresh } = useReportChart(() => ({
  animationDuration: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
  color: [token(definition.value.color), token(definition.value.color)],
  textStyle: { color: token('--color-text') },
  grid: { left: 8, right: 12, top: 42, bottom: 32, containLabel: true },
  legend: { top: 0, selectedMode: false, textStyle: { color: token('--color-muted') } },
  xAxis: { type: 'category', data: props.report.buckets.map((item) => item.label), axisLabel: { color: token('--color-muted') },
    axisLine: { lineStyle: { color: token('--color-border') } } },
  yAxis: { type: 'value', axisLabel: { color: token('--color-muted'), formatter: (value: number) => `¥${value}` },
    splitLine: { lineStyle: { color: token('--color-border'), type: 'dashed' } } },
  series: [
    { name: '当期', type: 'line', silent: true, showSymbol: props.report.buckets.length < 32, smooth: false,
      lineStyle: { color: token(definition.value.color), width: 3 }, itemStyle: { color: token(definition.value.color) },
      data: props.report.buckets.map((item) => Number(item[definition.value.field])) },
    { name: '累计', type: 'line', silent: true, showSymbol: false,
      lineStyle: { color: token(definition.value.color), type: 'dashed', width: 2, opacity: 0.65 },
      data: props.report.buckets.map((item) => Number(item[definition.value.cumulative])) },
  ],
}))

watch(() => [props.report, props.metric], () => { selected.value = 0; refresh() }, { deep: true })
function comparisonText(value: NonNullable<typeof comparison.value>['periodOverPeriod'] | undefined): string {
  if (!value) return '暂无数据'
  if (value.unavailableReason) return value.unavailableReason
  const percent = Number(value.changePercent)
  return `${percent >= 0 ? '增加' : '减少'} ${Math.abs(percent).toFixed(2)}% · 对比 ${formatCny(value.amount ?? '0')}`
}
</script>

<template>
  <section
    class="chart-panel time-trend"
    aria-label="时间趋势"
  >
    <header>
      <div>
        <p class="eyebrow">
          时间趋势
        </p><h2 class="section-title">
          {{ definition.label }}
        </h2>
      </div><span>实线为当期，虚线为累计</span>
    </header>
    <div
      class="comparison-grid"
      aria-label="对比结果"
    >
      <article><small>环比</small><strong>{{ comparisonText(comparison?.periodOverPeriod) }}</strong></article>
      <article><small>同比</small><strong>{{ comparisonText(comparison?.yearOverYear) }}</strong></article>
    </div>
    <div
      v-if="selectedBucket"
      id="time-point-reading"
      class="chart-readout"
      role="group"
      aria-label="时间点固定读数"
    >
      <strong>{{ selectedBucket.label }} · {{ metricCount(selectedBucket) }} 条</strong>
      <span>当期 <b>{{ formatCny(selectedBucket[definition.field]) }}</b></span>
      <span>累计 <b>{{ formatCny(selectedBucket[definition.cumulative]) }}</b></span>
    </div>
    <div
      ref="host"
      class="chart-canvas"
      aria-hidden="true"
    />
    <div
      v-if="selectedBucket"
      class="time-drill"
    >
      <label for="time-point">选择时间点</label>
      <select
        id="time-point"
        v-model.number="selected"
        class="select-control"
        aria-describedby="time-point-reading"
      >
        <option
          v-for="(bucket, index) in report.buckets"
          :key="bucket.startDate"
          :value="index"
        >
          {{ bucket.label }} · {{ formatCny(bucket[definition.field]) }} · {{ metricCount(bucket) }} 条
        </option>
      </select>
      <button
        class="secondary-button"
        type="button"
        @click="emit('select', report.buckets[selected])"
      >
        查看明细
      </button>
    </div>
  </section>
</template>
