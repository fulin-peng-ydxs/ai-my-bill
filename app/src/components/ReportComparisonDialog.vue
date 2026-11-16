<script setup lang="ts">
import type { TimeReport } from '../api/reports'
import { formatCny, formatDecimalDisplay } from '../domain/money'
import AppDialog from './AppDialog.vue'

defineProps<{
  open: boolean
  metricLabel: string
  comparison?: TimeReport['comparisons'][number]
}>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
function comparisonText(value: TimeReport['comparisons'][number]['periodOverPeriod'] | undefined): string {
  if (!value) return '暂无数据'
  if (value.unavailableReason) return value.unavailableReason
  const percent = value.changePercent ?? '0'
  const magnitude = formatDecimalDisplay(percent.replace(/^[-+]/, ''))
  return `${percent.startsWith('-') && magnitude !== '0' ? '减少' : '增加'} ${magnitude}% · 对比 ${formatCny(value.amount ?? '0')}`
}
</script>

<template>
  <AppDialog
    id="report-comparison"
    :open="open"
    title="范围对比"
    :description="`比较当前筛选范围的${metricLabel}合计，不随所选时段变化。`"
    confirm-label="知道了"
    :show-cancel="false"
    @update:open="emit('update:open', $event)"
    @confirm="emit('update:open', false)"
  >
    <div
      class="comparison-grid"
      aria-label="对比结果"
    >
      <article>
        <small>上一时段（环比）</small>
        <span v-if="comparison?.periodOverPeriod">{{ comparison.periodOverPeriod.startDate }} 至 {{ comparison.periodOverPeriod.endDate }}</span>
        <strong>{{ comparisonText(comparison?.periodOverPeriod) }}</strong>
      </article>
      <article>
        <small>去年同期（同比）</small>
        <span v-if="comparison?.yearOverYear">{{ comparison.yearOverYear.startDate }} 至 {{ comparison.yearOverYear.endDate }}</span>
        <strong>{{ comparisonText(comparison?.yearOverYear) }}</strong>
      </article>
    </div>
  </AppDialog>
</template>
