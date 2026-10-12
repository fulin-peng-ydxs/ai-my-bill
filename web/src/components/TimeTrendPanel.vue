<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { ReportTimeMetric, TimeReport } from '../api/reports'
import { useReportChart } from '../composables/useReportChart'
import { formatCny } from '../domain/money'
import CompactSelect from './CompactSelect.vue'
import MoneyValue from './MoneyValue.vue'
import AppStateBlock from './AppStateBlock.vue'
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
const emit = defineEmits<{
  select: [bucket: Bucket]
  compare: [value: { label: string, comparison: TimeReport['comparisons'][number] | undefined }]
}>()
const selected = ref(0)
const selectedBucket = computed(() => props.report.buckets[selected.value])
const periodOptions = computed(() => props.report.buckets.map((bucket, index) => ({ value: String(index), label: bucket.label })))
const definition = computed(() => DEFINITIONS[props.metric])
const amountClass = computed(() => props.metric === 'BALANCE' ? undefined
  : props.metric === 'GROSS_EXPENSE' || props.metric === 'NET_EXPENSE' ? 'money-expense' : 'money-income')
const comparison = computed(() => props.report.comparisons.find((item) => item.metric === props.metric))
const rangeAmount = computed(() => comparison.value?.currentAmount
  ?? props.report.buckets.at(-1)?.[definition.value.cumulative] ?? '0')
function metricCount(bucket: Bucket): number {
  if (props.metric === 'TOTAL_INCOME') return bucket.incomeCount
  if (props.metric === 'GROSS_EXPENSE') return bucket.expenseCount
  if (props.metric === 'ADJUSTMENT') return bucket.adjustmentCount
  if (props.metric === 'NET_EXPENSE') return bucket.expenseCount + bucket.adjustmentCount
  return bucket.itemCount
}
const { host, token, numberLabelStyle, refresh, failed } = useReportChart(() => ({
  color: [token(definition.value.color), token(definition.value.color)],
  textStyle: { color: token('--color-text') },
  grid: { left: 8, right: 12, top: 42, bottom: 32, containLabel: true },
  legend: { top: 0, selectedMode: false, textStyle: { color: token('--color-muted') } },
  xAxis: { type: 'category', data: props.report.buckets.map((item) => item.label), axisLabel: { color: token('--color-muted') },
    axisLine: { lineStyle: { color: token('--color-border') } } },
  yAxis: { type: 'value', axisLabel: { ...numberLabelStyle(), color: token('--color-muted'), formatter: (value: number) => `¥${value}` },
    splitLine: { lineStyle: { color: token('--color-border'), type: 'dashed' } } },
  series: [
    // SVG 连线的入场裁剪会在 WebKit 首次切换时隐藏线条；两条线直接呈现完整形状。
    { name: '当期', type: 'line', animation: false, silent: true, showSymbol: props.report.buckets.length < 32, smooth: false,
      lineStyle: { color: token(definition.value.color), width: 3 }, itemStyle: { color: token(definition.value.color) },
      data: props.report.buckets.map((item) => Number(item[definition.value.field])) },
    { name: '累计', type: 'line', animation: false, silent: true, showSymbol: false,
      lineStyle: { color: token(definition.value.color), type: 'dashed', width: 2, opacity: 0.65 },
      data: props.report.buckets.map((item) => Number(item[definition.value.cumulative])) },
  ],
}))

watch(() => [props.report, props.metric], () => {
  // 优先呈现最近有记录的时段，避免首个补零日期让用户误以为整段时间没有账目。
  let latest = props.report.buckets.length - 1
  while (latest >= 0 && metricCount(props.report.buckets[latest]) === 0) latest -= 1
  selected.value = Math.max(0, latest)
  refresh()
}, { deep: true, immediate: true })
</script>

<template>
  <section
    class="chart-panel time-trend"
    aria-label="时间趋势"
  >
    <header>
      <h2 class="section-title">
        {{ definition.label }}趋势
      </h2>
      <div class="trend-range-summary">
        <span>范围合计 <b :class="amountClass"><MoneyValue
          v-if="metric === 'BALANCE'"
          :amount="rangeAmount"
        /><template v-else>{{ formatCny(rangeAmount) }}</template></b></span>
        <button
          class="text-action"
          type="button"
          aria-haspopup="dialog"
          @click="emit('compare', { label: definition.label, comparison })"
        >
          范围对比
        </button>
      </div>
    </header>
    <div
      ref="host"
      class="chart-canvas"
      aria-hidden="true"
    />
    <AppStateBlock
      v-if="failed"
      kind="error"
      title="图表加载失败"
      message="金额与明细仍可查看。"
      action-label="重试图表"
      @action="refresh"
    />
    <div
      v-if="selectedBucket"
      class="time-drill"
    >
      <CompactSelect
        id="time-point"
        label="查看时段"
        described-by="time-point-reading"
        :show-label="true"
        :model-value="String(selected)"
        :options="periodOptions"
        @update:model-value="selected = Number($event)"
      />
      <button
        class="text-action"
        type="button"
        :aria-label="`查看${selectedBucket.label}的${definition.label}明细`"
        :disabled="metricCount(selectedBucket) === 0"
        @click="emit('select', selectedBucket)"
      >
        查看明细
      </button>
      <div
        id="time-point-reading"
        class="chart-readout"
        role="status"
        aria-label="所选时段金额"
      >
        <strong>{{ selectedBucket.label }} · {{ metricCount(selectedBucket) }} 条</strong>
        <span>当期 <b :class="amountClass"><MoneyValue
          v-if="metric === 'BALANCE'"
          :amount="selectedBucket[definition.field]"
        /><template v-else>{{ formatCny(selectedBucket[definition.field]) }}</template></b></span>
        <span>累计至该时段 <b :class="amountClass"><MoneyValue
          v-if="metric === 'BALANCE'"
          :amount="selectedBucket[definition.cumulative]"
        /><template v-else>{{ formatCny(selectedBucket[definition.cumulative]) }}</template></b></span>
      </div>
    </div>
  </section>
</template>
