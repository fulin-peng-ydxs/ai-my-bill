<script setup lang="ts">
import { BarChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { use } from 'echarts/core'
import { computed, watch } from 'vue'

import type { ExpenseReport, IncomeReport } from '../api/reports'
import { useReportChart } from '../composables/useReportChart'
import { formatCny } from '../domain/money'
import AppStateBlock from './AppStateBlock.vue'

use([BarChart, GridComponent])
type Point = ExpenseReport['points'][number] | IncomeReport['points'][number]
type QualityRule = NonNullable<ExpenseReport['qualityRule']>
const props = defineProps<{
  report: ExpenseReport | IncomeReport
  title: string
  eyebrow: string
  tone: 'expense' | 'income'
}>()
const emit = defineEmits<{ select: [point: Point] }>()
const points = computed<Point[]>(() => props.report.points)
const chartPoints = computed(() => [...points.value.slice(0, 12)].reverse())
const isCount = computed(() => props.report.dimension === 'FREQUENCY')
const qualityRule = computed<QualityRule | undefined>(() => 'qualityRule' in props.report
  ? props.report.qualityRule : undefined)
const isQuality = computed(() => qualityRule.value !== undefined)

function warning(point: Point): string | undefined {
  return 'warning' in point ? point.warning : undefined
}

function displayValue(point: Point): string {
  return isCount.value ? `${Number(point.amount)} 条` : formatCny(point.amount)
}

const { host, token, refresh } = useReportChart(() => ({
  animationDuration: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
  color: [token(props.tone === 'income' ? '--color-income-accent' : '--color-expense-accent')],
  textStyle: { color: token('--color-text') },
  grid: { left: 8, right: 112, top: 8, bottom: 8, containLabel: true },
  xAxis: { type: 'value', splitNumber: 3, axisLabel: { color: token('--color-muted'), hideOverlap: true,
    formatter: (value: number) => isCount.value ? String(value) : `¥${value}` },
  splitLine: { lineStyle: { color: token('--color-border'), type: 'dashed' } } },
  yAxis: { type: 'category', data: chartPoints.value.map((point) => point.label),
    axisLabel: { color: token('--color-muted'), width: 92, overflow: 'truncate' }, axisTick: { show: false },
    axisLine: { lineStyle: { color: token('--color-border') } } },
  series: [{ type: 'bar', silent: true, label: { show: true, position: 'right', fontSize: 12, color: token('--color-text'),
    width: 104, overflow: 'truncate', formatter: (item: { dataIndex: number }) => displayValue(chartPoints.value[item.dataIndex]) }, data: chartPoints.value.map((point) => Number(point.amount)), barMaxWidth: 24 }],
}))

watch(() => props.report, refresh, { deep: true })
</script>

<template>
  <section
    class="chart-panel report-dimension-panel"
    :aria-label="title"
  >
    <header>
      <div>
        <p class="eyebrow">
          {{ eyebrow }}
        </p>
        <h2 class="section-title">
          {{ title }}
        </h2>
      </div>
      <span>{{ report.measureLabel }} · 选择排行查看明细</span>
    </header>

    <div
      v-if="qualityRule"
      class="quality-rule"
    >
      <strong>规则 {{ qualityRule.version }}</strong>
      <span>高价：过去 {{ qualityRule.priceWindowDays }} 天至少 {{ qualityRule.minimumPriceSamples }} 条，超过中位数 {{ Number(qualityRule.highPriceMultiplier) * 100 - 100 }}%</span>
      <span>重复：同商品、金额和资金渠道在 {{ qualityRule.duplicateWindowMinutes }} 分钟内再次出现</span>
      <small>只提示线索，不会修改、合并或删除账目。</small>
    </div>

    <div
      v-if="!isQuality && points.length"
      ref="host"
      class="chart-canvas report-ranking-chart"
      aria-hidden="true"
    />

    <div
      v-if="points.length"
      class="dimension-ranking"
      aria-label="可下钻排行"
    >
      <button
        v-for="point in points"
        :key="`${point.group}:${point.value}:${warning(point) ?? ''}`"
        type="button"
        :class="{ 'quality-clue': warning(point) }"
        @click="emit('select', point)"
      >
        <span class="dimension-rank-main">
          <small>{{ point.group }}</small>
          <strong>{{ point.label }}</strong>
          <span>{{ point.detail }}</span>
        </span>
        <span class="dimension-rank-value">
          <em v-if="warning(point)">{{ warning(point) }}</em>
          <strong>{{ displayValue(point) }}</strong>
          <small v-if="point.sharePercent">{{ point.sharePercent }}% · {{ point.itemCount }} 条</small>
          <small v-else>{{ isCount ? '查看明细' : `${point.itemCount} 条 · 查看明细` }}</small>
        </span>
      </button>
    </div>
    <AppStateBlock
      v-else
      kind="empty"
      :title="isQuality ? '当前没有质量线索' : '当前维度没有可分析数据'"
      :message="isQuality ? '账目仍保持原样，规则会随筛选重新计算。' : '可调整日期或高级筛选后重试。'"
    />
    <p
      v-if="report.truncated"
      class="caption"
    >
      仅展示当前排序前 {{ isQuality ? 100 : 50 }} 项，请缩小筛选范围查看其余结果。
    </p>
  </section>
</template>
