<script setup lang="ts">
import { pageScrollTop, scrollPageTo } from '../composables/pageScroll'
import { usePageActivity } from '../composables/usePageActivity'
import { useRefreshOnReturn } from '../composables/useRefreshOnReturn'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { LedgerDateRange, LedgerFilters } from '../api/ledgerEntries'
import type { ExpenseReport,
  IncomeReport, ReportFilters, ReportScope, ReportSummary, ReportTimeGrain,
  ReportTimeMetric, TimeReport } from '../api/reports'
import PageWorkspace from '../components/PageWorkspace.vue'
import PageHeading from '../components/PageHeading.vue'
import { hasFilterChanges } from '../domain/filterChanges'
import AppliedFilterBar, { type AppliedFilterSummary } from '../components/AppliedFilterBar.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import ChartPanel from '../components/ChartPanel.vue'
import FilterSheet from '../components/FilterSheet.vue'
import DateTimeControl from '../components/DateTimeControl.vue'
import FormField from '../components/FormField.vue'
import GlobalLedgerSearch from '../components/GlobalLedgerSearch.vue'
import MoneySummary, { type MoneySummaryItem } from '../components/MoneySummary.vue'
import ReportDimensionPanel from '../components/ReportDimensionPanel.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import TimeTrendPanel from '../components/TimeTrendPanel.vue'
import { useReportData } from '../composables/useReportData'
import { useDictionaryFilterLabels } from '../composables/useDictionaryFilterLabels'
import DictionaryFilterPicker from '../components/DictionaryFilterPicker.vue'
import { ledgerRangeOptions, ledgerRouteQuery, optionLabel, type LedgerDrillContext } from '../domain/ledgerQuery'
import {
  clearIncompatibleReportFilters, clearedReportFilters,
  parseReportPresentation, parseReportRoute, reportPresentationQuery, reportRouteQuery, reportScopeOptions,
  type ReportDimension,
} from '../domain/reportQuery'
import { usePreferencesStore } from '../stores/preferences'

const pageActive = usePageActivity()
const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const request = useReportData()
const searchText = ref('')
const filters = ref<ReportFilters>({ query: '', scope: 'ALL', range: 'THIS_MONTH' })
const draft = ref<ReportFilters>({ ...filters.value })
const filterOpen = ref(false)
const focusedFilter = ref<keyof ReportFilters>()
const rangeError = ref('')
const defaultRange = computed<LedgerDateRange>(() => preferences.values.reportDefaultRange)
const hasFilters = computed(() => hasFilterChanges(filters.value, clearedReportFilters(defaultRange.value, filters.value.scope)))
const parsed = computed(() => parseReportRoute(route.query, defaultRange.value))
const presentation = computed(() => parseReportPresentation(route.query, parsed.value))
const shownFilters = computed(() => request.data.value?.filters ?? filters.value)
const shownPresentation = computed(() => request.data.value?.presentation ?? presentation.value)
const nameFor = useDictionaryFilterLabels(() => shownFilters.value)
function optionsFor(scope: ReportScope): { value: ReportDimension, label: string }[] { return [
  { value: 'OVERVIEW', label: '收支概览' }, { value: 'TIME', label: '时间趋势' },
  ...(scope === 'EXPENSE' ? [
    { value: 'CATEGORY' as const, label: '分类结构' }, { value: 'PRODUCT' as const, label: '商品排行' },
    { value: 'FUNDING_CHANNEL' as const, label: '支付方式' }, { value: 'PURCHASE_CHANNEL' as const, label: '购买渠道' },
    { value: 'LOCATION' as const, label: '常用地点' }, { value: 'HABIT' as const, label: '消费习惯' },
    { value: 'PRICE' as const, label: '价格观察' }, { value: 'FREQUENCY' as const, label: '消费频次' },
    { value: 'QUALITY' as const, label: '数据质量' },
  ] : []),
  ...(scope === 'INCOME' ? [
    { value: 'CATEGORY' as const, label: '收入分类' }, { value: 'FUNDING_CHANNEL' as const, label: '收款方式' },
    { value: 'PAYER' as const, label: '付款方' }, { value: 'NAME' as const, label: '收入名称' },
    { value: 'FREQUENCY' as const, label: '收入频次' },
  ] : []),
] }
const dimensionOptions = computed(() => optionsFor(filters.value.scope))
const dimensionTitle = computed(() => optionsFor(shownFilters.value.scope).find(item => item.value === shownPresentation.value.dimension)?.label ?? '分析维度')

const filterSummaries = computed<AppliedFilterSummary[]>(() => {
  const shown = shownFilters.value
  const fields = [
    ['fundingChannelId', '资金渠道'], ['primaryCategoryId', '一级分类'], ['secondaryCategoryId', '二级分类'],
    ['productId', '商品'], ['purchaseChannelId', '购买渠道'], ['locationLabelId', '地点'],
    ['incomeCategoryId', '收入分类'], ['payerId', '付款方'],
  ] as const
  return [
    { key: 'range', label: '日期', value: shown.range === 'CUSTOM' ? `${shown.startDate} 至 ${shown.endDate}` : optionLabel(ledgerRangeOptions, shown.range) },
    ...fields.filter(([key]) => shown[key]).map(([key, label]) => ({ key, label, value: nameFor(key) ?? '指定选项' })),
    ...(shown.incomeName ? [{ key: 'incomeName', label: '收入名称', value: shown.incomeName }] : []),
  ]
})
const filterTitle = computed(() => focusedFilter.value
  ? `修改${filterSummaries.value.find(item => item.key === focusedFilter.value)?.label ?? '筛选条件'}` : '报表筛选')
function openFilters(key?: string): void {
  focusedFilter.value = key as keyof ReportFilters | undefined
  draft.value = { ...(key ? shownFilters.value : filters.value) }
  rangeError.value = ''
  filterOpen.value = true
}
function showFilter(key: keyof ReportFilters): boolean {
  return filterOpen.value && (!focusedFilter.value || focusedFilter.value === key
    || (focusedFilter.value === 'secondaryCategoryId' && key === 'primaryCategoryId'))
}

const summaryItems = computed<MoneySummaryItem[]>(() => {
  const data = request.data.value?.summary
  if (!data) return []
  if (shownFilters.value.scope === 'EXPENSE') return [
    { key: 'gross', label: '原始支出', amount: data.grossExpense, tone: 'expense', sign: '-' },
    { key: 'adjustment', label: '退款/报销冲减', amount: data.adjustmentAmount, tone: 'income', sign: '+' },
    { key: 'net', label: '净支出', amount: data.netExpense, tone: 'expense', sign: '-' },
  ]
  if (shownFilters.value.scope === 'INCOME') return [
    { key: 'income', label: '总收入', amount: data.totalIncome, tone: 'income', sign: '+' },
  ]
  return [
    { key: 'income', label: '总收入', amount: data.totalIncome, tone: 'income', sign: '+' },
    { key: 'gross', label: '原始支出', amount: data.grossExpense, tone: 'expense', sign: '-' },
    { key: 'adjustment', label: '退款/报销冲减', amount: data.adjustmentAmount, tone: 'income', sign: '+' },
    { key: 'net', label: '净支出', amount: data.netExpense, tone: 'expense', sign: '-' },
    { key: 'balance', label: '结余', amount: data.balance, tone: 'neutral', sign: '' },
  ]
})

async function load(): Promise<void> {
  await request.load(filters.value, presentation.value)
  const scroll = Number.parseInt(typeof route.query.scroll === 'string' ? route.query.scroll : '', 10)
  if (Number.isSafeInteger(scroll) && scroll >= 0) await nextTick(() => { if (pageActive.value) scrollPageTo(scroll) })
}

watch([() => route.fullPath, () => preferences.status], () => {
  if (preferences.status === 'idle' || preferences.status === 'loading') return
  filters.value = { ...parsed.value }
  searchText.value = filters.value.query
  draft.value = { ...filters.value }
  void load()
}, { immediate: true })

function navigate(next: ReportFilters): void {
  void router.replace({ query: reportPresentationQuery(next, parseReportPresentation(route.query, next)) })
}
function updatePresentation(change: Partial<{ dimension: ReportDimension, grain: ReportTimeGrain, metric: ReportTimeMetric }>): void {
  void router.replace({ query: reportPresentationQuery(filters.value, { ...presentation.value, ...change }) })
}
function updateSearch(value: string): void { navigate({ ...filters.value, query: value }) }
function updateScope(value: string): void { navigate(clearIncompatibleReportFilters(filters.value, value as ReportScope)) }
function clearFilters(): void { navigate(clearedReportFilters(defaultRange.value, filters.value.scope)) }
function setDraftRange(value: LedgerDateRange): void {
  draft.value = { ...draft.value, range: value, ...(value === 'CUSTOM' ? {} : { startDate: undefined, endDate: undefined }) }
  rangeError.value = ''
}
function updatePrimaryCategory(value: string | undefined): void {
  draft.value.primaryCategoryId = value
  draft.value.secondaryCategoryId = undefined
}
function applyFilters(): void {
  if (draft.value.range === 'CUSTOM' && (!draft.value.startDate || !draft.value.endDate || draft.value.endDate < draft.value.startDate)) {
    rangeError.value = '请选择完整日期，且结束日期不能早于开始日期。'
    return
  }
  rangeError.value = ''
  filterOpen.value = false
  navigate({ ...draft.value, query: filters.value.query })
}

function drill(point: ReportSummary['dataPoints'][number]): void {
  if (!request.canDrill.value) return
  const ledgerFilters: LedgerFilters = {
    ...shownFilters.value, type: point.value, lifecycle: 'ACTIVE',
  }
  delete (ledgerFilters as Partial<ReportFilters>).scope
  const context: LedgerDrillContext = {
    scope: shownFilters.value.scope, dimension: 'OVERVIEW', value: point.value, label: point.label,
    reportQuery: { ...reportRouteQuery(shownFilters.value), dimension: 'OVERVIEW' }, reportScroll: Math.round(pageScrollTop()),
  }
  void router.push({ path: '/ledger', query: ledgerRouteQuery(ledgerFilters, context) })
}

function drillTime(bucket: TimeReport['buckets'][number]): void {
  if (!request.canDrill.value) return
  const type = shownPresentation.value.metric === 'TOTAL_INCOME' ? 'INCOME'
    : shownPresentation.value.metric === 'BALANCE' ? 'ALL'
      : shownPresentation.value.metric === 'ADJUSTMENT' ? 'ADJUSTMENT'
        : shownPresentation.value.metric === 'NET_EXPENSE' ? 'EXPENSE_FLOW' : 'EXPENSE'
  const ledgerFilters: LedgerFilters = { ...shownFilters.value, type, lifecycle: 'ACTIVE', range: 'CUSTOM',
    startDate: bucket.startDate, endDate: bucket.endDate }
  delete (ledgerFilters as Partial<ReportFilters>).scope
  const context: LedgerDrillContext = { scope: shownFilters.value.scope, dimension: 'TIME',
    value: `${bucket.startDate}/${bucket.endDate}`, label: bucket.label,
    reportQuery: reportPresentationQuery(shownFilters.value, shownPresentation.value),
    reportScroll: Math.round(pageScrollTop()) }
  void router.push({ path: '/ledger', query: ledgerRouteQuery(ledgerFilters, context) })
}

function drillExpense(point: ExpenseReport['points'][number]): void {
  if (!request.canDrill.value) return
  const ledgerFilters: LedgerFilters = { ...shownFilters.value, type: 'EXPENSE', lifecycle: 'ACTIVE' }
  delete (ledgerFilters as Partial<ReportFilters>).scope
  const dimension = shownPresentation.value.dimension
  if (dimension === 'CATEGORY') {
    if (shownFilters.value.primaryCategoryId) {
      if (point.value === 'UNSPECIFIED') ledgerFilters.missingSecondaryCategory = true
      else ledgerFilters.secondaryCategoryId = point.value
    } else ledgerFilters.primaryCategoryId = point.value
  } else if (dimension === 'PRODUCT' || dimension === 'PRICE') {
    const [productId, unitId] = point.value.split('|')
    ledgerFilters.productId = productId
    ledgerFilters.unitId = unitId
  } else if (dimension === 'FUNDING_CHANNEL') ledgerFilters.fundingChannelId = point.value
  else if (dimension === 'PURCHASE_CHANNEL') {
    if (point.value === 'UNSPECIFIED') ledgerFilters.missingPurchaseChannel = true
    else ledgerFilters.purchaseChannelId = point.value
  } else if (dimension === 'LOCATION') {
    if (point.value === 'UNSPECIFIED') ledgerFilters.missingLocation = true
    else ledgerFilters.locationLabelId = point.value
  } else if (dimension === 'HABIT') {
    const [kind, value] = point.value.split(':')
    if (kind === 'WEEKDAY') ledgerFilters.expenseWeekday = Number(value)
    else if (kind === 'TIME') ledgerFilters.expenseTimeBand = value as NonNullable<LedgerFilters['expenseTimeBand']>
  } else if (dimension === 'FREQUENCY') {
    if (point.entryId) ledgerFilters.entryId = point.entryId
    else ledgerFilters.productId = point.value
  } else if (dimension === 'QUALITY' && point.entryId) ledgerFilters.entryId = point.entryId
  if (point.drillStartDate && point.drillEndDate) {
    ledgerFilters.range = 'CUSTOM'
    ledgerFilters.startDate = point.drillStartDate
    ledgerFilters.endDate = point.drillEndDate
  }
  const context: LedgerDrillContext = {
    scope: 'EXPENSE', dimension, value: point.value, label: point.label,
    reportQuery: reportPresentationQuery(shownFilters.value, shownPresentation.value), reportScroll: Math.round(pageScrollTop()),
  }
  void router.push({ path: '/ledger', query: ledgerRouteQuery(ledgerFilters, context) })
}

function drillIncome(point: IncomeReport['points'][number]): void {
  if (!request.canDrill.value) return
  const ledgerFilters: LedgerFilters = { ...shownFilters.value, type: 'INCOME', lifecycle: 'ACTIVE' }
  delete (ledgerFilters as Partial<ReportFilters>).scope
  const dimension = shownPresentation.value.dimension
  if (dimension === 'CATEGORY') ledgerFilters.incomeCategoryId = point.value
  else if (dimension === 'FUNDING_CHANNEL') ledgerFilters.fundingChannelId = point.value
  else if (dimension === 'PAYER') ledgerFilters.payerId = point.value
  else if (dimension === 'NAME' || dimension === 'FREQUENCY') ledgerFilters.incomeName = point.value
  const context: LedgerDrillContext = {
    scope: 'INCOME', dimension, value: point.value, label: point.label,
    reportQuery: reportPresentationQuery(shownFilters.value, shownPresentation.value), reportScroll: Math.round(pageScrollTop()),
  }
  void router.push({ path: '/ledger', query: ledgerRouteQuery(ledgerFilters, context) })
}
useRefreshOnReturn(() => load())
</script>

<template>
  <PageWorkspace
    content-label="报表结果"
    class="report-page"
    data-page-key="reports"
  >
    <template #header>
      <PageHeading title="收支报表" />

      <div class="list-search-controls">
        <GlobalLedgerSearch
          id="report-search"
          v-model="searchText"
          @search="updateSearch"
        />
        <SegmentedControl
          label="账目范围"
          :model-value="filters.scope"
          :options="reportScopeOptions"
          @update:model-value="updateScope"
        />
      </div>
      <AppliedFilterBar
        :summaries="filterSummaries"
        :clearable="hasFilters"
        label="报表已应用筛选"
        @open="openFilters()"
        @edit="openFilters"
        @clear="clearFilters"
      />

      <section class="report-dimension">
        <div>
          <label for="report-dimension">
            分析维度
            <span
              class="report-refresh-status"
              role="status"
              aria-live="polite"
            >{{ request.refreshing.value ? '更新中…' : '' }}</span>
          </label>
          <select
            id="report-dimension"
            class="select-control"
            :value="presentation.dimension"
            @change="updatePresentation({ dimension: ($event.target as HTMLSelectElement).value as ReportDimension })"
          >
            <option
              v-for="item in dimensionOptions"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </option>
          </select>
        </div>
        <div v-if="presentation.dimension === 'TIME'">
          <label for="report-grain">时间粒度</label>
          <select
            id="report-grain"
            class="select-control"
            :value="presentation.grain"
            @change="updatePresentation({ grain: ($event.target as HTMLSelectElement).value as ReportTimeGrain })"
          >
            <option value="DAY">
              日
            </option><option value="WEEK">
              周
            </option><option value="MONTH">
              月
            </option>
            <option value="QUARTER">
              季
            </option><option value="YEAR">
              年
            </option>
          </select>
        </div>
        <div v-if="presentation.dimension === 'TIME'">
          <label for="report-metric">趋势指标</label>
          <select
            id="report-metric"
            class="select-control"
            :value="presentation.metric"
            @change="updatePresentation({ metric: ($event.target as HTMLSelectElement).value as ReportTimeMetric })"
          >
            <option
              v-if="filters.scope !== 'EXPENSE'"
              value="TOTAL_INCOME"
            >
              总收入
            </option>
            <option
              v-if="filters.scope !== 'INCOME'"
              value="GROSS_EXPENSE"
            >
              原始支出
            </option>
            <option
              v-if="filters.scope !== 'INCOME'"
              value="ADJUSTMENT"
            >
              退款/报销冲减
            </option>
            <option
              v-if="filters.scope !== 'INCOME'"
              value="NET_EXPENSE"
            >
              净支出
            </option>
            <option
              v-if="filters.scope === 'ALL'"
              value="BALANCE"
            >
              结余
            </option>
          </select>
        </div>
      </section>
    </template>
    <AppStateBlock
      v-if="request.status.value === 'loading' && !request.data.value"
      kind="loading"
      title="正在计算报表"
      message="正在更新，请稍候。"
    />
    <AppStateBlock
      v-if="request.error.value"
      :kind="request.error.value.kind === 'forbidden' ? 'permission' : 'error'"
      title="报表加载失败"
      :message="request.data.value ? '仍显示上次成功条件的结果，暂不可下钻。' : request.error.value.message"
      :action-label="request.error.value.kind === 'forbidden' ? undefined : '重试'"
      @action="load"
    />
    <MoneySummary
      v-if="request.data.value"
      :items="summaryItems"
      label="已展示条件金额摘要"
    />
    <fieldset
      v-if="request.data.value"
      class="report-result"
      :disabled="!request.canDrill.value"
      :aria-busy="request.refreshing.value"
    >
      <legend class="sr-only">
        {{ dimensionTitle }} · 已展示条件
      </legend>
      <AppStateBlock
        v-if="request.data.value.summary.matchingItemCount === 0 && shownPresentation.dimension === 'OVERVIEW'"
        kind="empty"
        title="当前条件没有账目"
        message="可调整日期范围或切换分析维度。"
      />
      <ChartPanel
        v-else-if="shownPresentation.dimension === 'OVERVIEW'"
        title="收支概览"
        :points="request.data.value.summary.dataPoints"
        @select="drill"
      />
      <TimeTrendPanel
        v-else-if="request.data.value.time"
        :report="request.data.value.time"
        :metric="shownPresentation.metric"
        @select="drillTime"
      />
      <ReportDimensionPanel
        v-else-if="request.data.value.expense"
        :report="request.data.value.expense"
        :title="dimensionTitle"
        eyebrow="支出分析"
        tone="expense"
        @select="drillExpense"
      />
      <ReportDimensionPanel
        v-else-if="request.data.value.income"
        :report="request.data.value.income"
        :title="dimensionTitle"
        eyebrow="收入分析"
        tone="income"
        @select="drillIncome"
      />
    </fieldset>

    <template #overlays>
      <FilterSheet
        id="report-filter"
        v-model:open="filterOpen"
        :title="filterTitle"
        :apply-label="focusedFilter ? '确定' : '应用筛选'"
        @apply="applyFilters"
      >
        <FormField
          v-if="showFilter('range')"
          field-id="report-range"
          label="日期范围"
          :error="rangeError"
        >
          <template #default="{ describedBy }">
            <select
              id="report-range"
              :value="draft.range"
              :aria-describedby="describedBy"
              @change="setDraftRange(($event.target as HTMLSelectElement).value as LedgerDateRange)"
            >
              <option
                v-for="option in ledgerRangeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </template>
        </FormField>
        <div
          v-if="showFilter('range') && draft.range === 'CUSTOM'"
          class="form-grid-two"
        >
          <FormField
            field-id="report-start-date"
            label="开始日期"
          >
            <DateTimeControl
              id="report-start-date"
              v-model="draft.startDate"
              :aria-describedby="rangeError ? 'report-range-error' : undefined"
              :aria-invalid="Boolean(rangeError)"
              type="date"
            />
          </FormField>
          <FormField
            field-id="report-end-date"
            label="结束日期"
          >
            <DateTimeControl
              id="report-end-date"
              v-model="draft.endDate"
              :aria-describedby="rangeError ? 'report-range-error' : undefined"
              :aria-invalid="Boolean(rangeError)"
              type="date"
            />
          </FormField>
        </div>
        <DictionaryFilterPicker
          v-if="showFilter('fundingChannelId')"
          id="report-funding"
          v-model="draft.fundingChannelId"
          type="funding-channel"
          label="资金渠道"
        />
        <template v-if="filterOpen && draft.scope === 'EXPENSE'">
          <DictionaryFilterPicker
            v-if="showFilter('primaryCategoryId')"
            id="report-primary-category"
            :model-value="draft.primaryCategoryId"
            type="expense-category"
            label="一级分类"
            roots-only
            @update:model-value="updatePrimaryCategory"
          />
          <DictionaryFilterPicker
            v-if="showFilter('secondaryCategoryId')"
            id="report-secondary-category"
            v-model="draft.secondaryCategoryId"
            type="expense-category"
            label="二级分类"
            :parent-id="draft.primaryCategoryId"
            :disabled="!draft.primaryCategoryId"
          />
          <DictionaryFilterPicker
            v-if="showFilter('productId')"
            id="report-product"
            v-model="draft.productId"
            type="product"
            label="商品"
          />
          <DictionaryFilterPicker
            v-if="showFilter('purchaseChannelId')"
            id="report-purchase"
            v-model="draft.purchaseChannelId"
            type="purchase-channel"
            label="购买渠道"
          />
          <DictionaryFilterPicker
            v-if="showFilter('locationLabelId')"
            id="report-location"
            v-model="draft.locationLabelId"
            type="location"
            label="地点"
          />
        </template>
        <template v-if="filterOpen && draft.scope === 'INCOME'">
          <DictionaryFilterPicker
            v-if="showFilter('incomeCategoryId')"
            id="report-income-category"
            v-model="draft.incomeCategoryId"
            type="income-category"
            label="收入分类"
          />
          <DictionaryFilterPicker
            v-if="showFilter('payerId')"
            id="report-payer"
            v-model="draft.payerId"
            type="payer"
            label="付款方"
          />
          <FormField
            v-if="showFilter('incomeName')"
            field-id="report-income-name"
            label="收入名称"
          >
            <input
              id="report-income-name"
              v-model="draft.incomeName"
              maxlength="100"
              placeholder="精确匹配收入名称"
            >
          </FormField>
        </template>
      </FilterSheet>
    </template>
  </PageWorkspace>
</template>
