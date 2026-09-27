<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { listDictionaryCandidates, type DictionaryItem } from '../api/dictionaries'
import type { LedgerDateRange, LedgerFilters } from '../api/ledgerEntries'
import { getReportSummary, getTimeReport, type ReportFilters, type ReportScope, type ReportSummary,
  type ReportTimeGrain, type ReportTimeMetric, type TimeReport } from '../api/reports'
import AppliedFilterBar from '../components/AppliedFilterBar.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import ChartPanel from '../components/ChartPanel.vue'
import FilterSheet from '../components/FilterSheet.vue'
import FormField from '../components/FormField.vue'
import GlobalLedgerSearch from '../components/GlobalLedgerSearch.vue'
import MoneySummary, { type MoneySummaryItem } from '../components/MoneySummary.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import TimeTrendPanel from '../components/TimeTrendPanel.vue'
import { useLatestRequest } from '../composables/useLatestRequest'
import { ledgerRangeOptions, ledgerRouteQuery, optionLabel, type LedgerDrillContext } from '../domain/ledgerQuery'
import {
  clearIncompatibleReportFilters, clearedReportFilters, parseReportPresentation, parseReportRoute,
  reportPresentationQuery, reportRouteQuery, reportScopeOptions, type ReportDimension,
} from '../domain/reportQuery'
import { usePreferencesStore } from '../stores/preferences'

type OptionKey = 'funding' | 'categories' | 'products' | 'purchase' | 'locations' | 'incomeCategories' | 'payers'
type OptionMap = Record<OptionKey, DictionaryItem[]>

const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const request = useLatestRequest<ReportSummary>()
const timeRequest = useLatestRequest<TimeReport>()
const optionsRequest = useLatestRequest<{ items: OptionMap, failures: string[] }>()
const searchText = ref('')
const filters = ref<ReportFilters>({ query: '', scope: 'ALL', range: 'THIS_MONTH' })
const draft = ref<ReportFilters>({ ...filters.value })
const filterOpen = ref(false)
const rangeError = ref('')
const optionFailures = ref<string[]>([])
const emptyOptions = (): OptionMap => ({ funding: [], categories: [], products: [], purchase: [], locations: [], incomeCategories: [], payers: [] })
const optionItems = reactive<OptionMap>(emptyOptions())
const FILTER_ID_KEYS = [
  'fundingChannelId', 'primaryCategoryId', 'secondaryCategoryId', 'productId',
  'purchaseChannelId', 'locationLabelId', 'incomeCategoryId', 'payerId',
] as const

const defaultRange = computed<LedgerDateRange>(() => preferences.values.reportDefaultRange)
const parsed = computed(() => parseReportRoute(route.query, defaultRange.value))
const presentation = computed(() => parseReportPresentation(route.query, parsed.value))
const rootCategories = computed(() => optionItems.categories.filter((item) => !item.parentId))
const secondaryCategories = computed(() => optionItems.categories.filter((item) => item.parentId === draft.value.primaryCategoryId))

function nameFor(key: OptionKey, id?: string): string | undefined {
  return id ? optionItems[key].find((item) => item.id === id)?.name : undefined
}

const filterSummaries = computed(() => [
  optionLabel(ledgerRangeOptions, filters.value.range),
  ...(filters.value.fundingChannelId ? [nameFor('funding', filters.value.fundingChannelId) ?? '指定资金渠道'] : []),
  ...(filters.value.primaryCategoryId ? [nameFor('categories', filters.value.primaryCategoryId) ?? '指定一级分类'] : []),
  ...(filters.value.secondaryCategoryId ? [nameFor('categories', filters.value.secondaryCategoryId) ?? '指定二级分类'] : []),
  ...(filters.value.productId ? [nameFor('products', filters.value.productId) ?? '指定商品'] : []),
  ...(filters.value.purchaseChannelId ? [nameFor('purchase', filters.value.purchaseChannelId) ?? '指定购买渠道'] : []),
  ...(filters.value.locationLabelId ? [nameFor('locations', filters.value.locationLabelId) ?? '指定地点'] : []),
  ...(filters.value.incomeCategoryId ? [nameFor('incomeCategories', filters.value.incomeCategoryId) ?? '指定收入分类'] : []),
  ...(filters.value.payerId ? [nameFor('payers', filters.value.payerId) ?? '指定付款方'] : []),
  ...(filters.value.incomeName ? [`收入名称：${filters.value.incomeName}`] : []),
])

const summaryItems = computed<MoneySummaryItem[]>(() => {
  const data = request.data.value
  if (!data) return []
  if (filters.value.scope === 'EXPENSE') return [
    { key: 'gross', label: '原始支出', amount: data.grossExpense, tone: 'expense', sign: '-' },
    { key: 'adjustment', label: '退款/报销冲减', amount: data.adjustmentAmount, tone: 'income', sign: '+' },
    { key: 'net', label: '净支出', amount: data.netExpense, tone: 'expense', sign: '-' },
  ]
  if (filters.value.scope === 'INCOME') return [
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
  const snapshot = { ...filters.value }
  const view = presentation.value
  await Promise.all([
    request.execute((signal) => getReportSummary(snapshot, signal), {
      intent: request.data.value ? 'refresh' : 'replace', isEmpty: (data) => data.matchingItemCount === 0,
    }),
    ...(view.dimension === 'TIME' ? [timeRequest.execute((signal) => getTimeReport(snapshot, view.grain, signal),
      { intent: 'replace' })] : []),
  ])
  const scroll = Number.parseInt(typeof route.query.scroll === 'string' ? route.query.scroll : '', 10)
  if (Number.isSafeInteger(scroll) && scroll >= 0) await nextTick(() => globalThis.scrollTo({ top: scroll }))
}

watch([() => route.fullPath, () => preferences.status], () => {
  if (preferences.status === 'idle' || preferences.status === 'loading') return
  filters.value = { ...parsed.value }
  searchText.value = filters.value.query
  draft.value = { ...filters.value }
  void load()
  if (FILTER_ID_KEYS.some((key) => filters.value[key]) && optionsRequest.status.value === 'idle') void loadOptions()
}, { immediate: true })

async function loadOptions(): Promise<void> {
  const definitions = [
    ['funding', '资金渠道', 'funding-channel'], ['categories', '支出分类', 'expense-category'],
    ['products', '商品', 'product'], ['purchase', '购买渠道', 'purchase-channel'], ['locations', '地点', 'location'],
    ['incomeCategories', '收入分类', 'income-category'], ['payers', '付款方', 'payer'],
  ] as const
  const loaded = await optionsRequest.execute(async (signal) => {
    const result = emptyOptions()
    const failures: string[] = []
    const settled = await Promise.allSettled(definitions.map(([, , type]) => listDictionaryCandidates(type, '', signal)))
    settled.forEach((entry, index) => {
      const [key, label] = definitions[index]
      if (entry.status === 'fulfilled') result[key] = entry.value.items
      else failures.push(label)
    })
    if (failures.length === definitions.length) throw new Error('筛选选项加载失败，请重试。')
    return { items: result, failures }
  }, { intent: optionsRequest.data.value ? 'refresh' : 'replace' })
  if (loaded) {
    Object.assign(optionItems, loaded.items)
    optionFailures.value = loaded.failures
  }
}

watch(filterOpen, (open) => {
  if (!open) return
  draft.value = { ...filters.value }
  rangeError.value = ''
  void loadOptions()
})

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
function updatePrimaryCategory(value: string): void {
  draft.value.primaryCategoryId = value || undefined
  if (!secondaryCategories.value.some((item) => item.id === draft.value.secondaryCategoryId)) draft.value.secondaryCategoryId = undefined
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
  const ledgerFilters: LedgerFilters = {
    ...filters.value, type: point.value, lifecycle: 'ACTIVE',
  }
  delete (ledgerFilters as Partial<ReportFilters>).scope
  const context: LedgerDrillContext = {
    scope: filters.value.scope, dimension: 'OVERVIEW', value: point.value,
    reportQuery: { ...reportRouteQuery(filters.value), dimension: 'OVERVIEW' }, reportScroll: Math.round(globalThis.scrollY),
  }
  void router.push({ path: '/ledger', query: ledgerRouteQuery(ledgerFilters, context) })
}

function drillTime(bucket: TimeReport['buckets'][number]): void {
  const type = presentation.value.metric === 'TOTAL_INCOME' ? 'INCOME'
    : presentation.value.metric === 'BALANCE' ? 'ALL'
      : presentation.value.metric === 'ADJUSTMENT' ? 'ADJUSTMENT'
        : presentation.value.metric === 'NET_EXPENSE' ? 'EXPENSE_FLOW' : 'EXPENSE'
  const ledgerFilters: LedgerFilters = { ...filters.value, type, lifecycle: 'ACTIVE', range: 'CUSTOM',
    startDate: bucket.startDate, endDate: bucket.endDate }
  delete (ledgerFilters as Partial<ReportFilters>).scope
  const context: LedgerDrillContext = { scope: filters.value.scope, dimension: 'TIME',
    value: `${bucket.startDate}/${bucket.endDate}`, reportQuery: reportPresentationQuery(filters.value, presentation.value),
    reportScroll: Math.round(globalThis.scrollY) }
  void router.push({ path: '/ledger', query: ledgerRouteQuery(ledgerFilters, context) })
}
</script>

<template>
  <article
    class="report-page"
    data-page-key="reports"
  >
    <header class="page-heading">
      <p class="eyebrow">
        当前租户 · 有效账目
      </p>
      <h1>收支报表</h1>
      <p>搜索、筛选、金额摘要和下钻共用同一服务端口径。</p>
    </header>

    <GlobalLedgerSearch
      id="report-search"
      v-model="searchText"
      label="搜索报表账目"
      placeholder="搜索名称、分类、付款方或备注"
      @search="updateSearch"
    />
    <SegmentedControl
      label="账目范围"
      :model-value="filters.scope"
      :options="reportScopeOptions"
      @update:model-value="updateScope"
    />
    <AppliedFilterBar
      :summaries="filterSummaries"
      label="报表已应用筛选"
      @open="filterOpen = true"
      @clear="clearFilters"
    />

    <AppStateBlock
      v-if="request.status.value === 'loading'"
      kind="loading"
      title="正在计算报表"
      message="所有区域会同时切换到新的筛选快照。"
    />
    <AppStateBlock
      v-else-if="request.status.value === 'empty'"
      kind="empty"
      title="当前条件没有账目"
      message="可清除筛选或选择其他日期范围。"
      action-label="清除筛选"
      @action="clearFilters"
    />
    <template v-else-if="request.data.value">
      <AppStateBlock
        v-if="request.error.value"
        kind="error"
        title="报表刷新失败，当前仍显示上一次结果"
        :message="request.error.value.message"
        action-label="重试"
        @action="load"
      />
      <MoneySummary
        :items="summaryItems"
        label="当前筛选金额摘要"
      />
      <section class="report-dimension">
        <div>
          <label for="report-dimension">分析维度</label>
          <select
            id="report-dimension"
            :value="presentation.dimension"
            @change="updatePresentation({ dimension: ($event.target as HTMLSelectElement).value as ReportDimension })"
          >
            <option value="OVERVIEW">
              口径总览
            </option>
            <option value="TIME">
              时间趋势
            </option>
          </select>
        </div>
        <div v-if="presentation.dimension === 'TIME'">
          <label for="report-grain">时间粒度</label>
          <select
            id="report-grain"
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
        <p v-if="presentation.dimension === 'OVERVIEW'">
          统一口径概览，可点击指标下钻。
        </p>
      </section>
      <ChartPanel
        v-if="presentation.dimension === 'OVERVIEW'"
        title="口径总览"
        :points="request.data.value.dataPoints"
        @select="drill"
      />
      <AppStateBlock
        v-else-if="timeRequest.status.value === 'loading'"
        kind="loading"
        title="正在计算时间趋势"
      />
      <AppStateBlock
        v-else-if="timeRequest.status.value === 'error'"
        kind="error"
        title="时间趋势加载失败"
        :message="timeRequest.error.value?.message"
        action-label="重试"
        @action="load"
      />
      <TimeTrendPanel
        v-else-if="timeRequest.data.value"
        :report="timeRequest.data.value"
        :metric="presentation.metric"
        @select="drillTime"
      />
    </template>
    <AppStateBlock
      v-else-if="request.status.value === 'error'"
      kind="error"
      title="报表加载失败"
      :message="request.error.value?.message"
      action-label="重试"
      @action="load"
    />

    <FilterSheet
      id="report-filter"
      v-model:open="filterOpen"
      title="报表筛选"
      @apply="applyFilters"
    >
      <FormField
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
        v-if="draft.range === 'CUSTOM'"
        class="form-grid-two"
      >
        <FormField
          field-id="report-start-date"
          label="开始日期"
          :error="rangeError"
        >
          <input
            id="report-start-date"
            v-model="draft.startDate"
            type="date"
          >
        </FormField>
        <FormField
          field-id="report-end-date"
          label="结束日期"
          :error="rangeError"
        >
          <input
            id="report-end-date"
            v-model="draft.endDate"
            type="date"
          >
        </FormField>
      </div>
      <AppStateBlock
        v-if="optionsRequest.status.value === 'loading'"
        kind="loading"
        title="正在加载筛选选项"
      />
      <AppStateBlock
        v-else-if="optionsRequest.status.value === 'error'"
        kind="error"
        title="筛选选项加载失败"
        :message="optionsRequest.error.value?.message"
        action-label="重试"
        @action="loadOptions"
      />
      <p
        v-else-if="optionFailures.length"
        class="field-error"
        role="alert"
      >
        {{ optionFailures.join('、') }}暂时不可用，其余条件仍可应用。
      </p>
      <FormField
        field-id="report-funding"
        label="资金渠道"
        help="“全部渠道”是不限条件，不会与同名字典项混淆。"
      >
        <select
          id="report-funding"
          v-model="draft.fundingChannelId"
        >
          <option :value="undefined">
            全部渠道（不限）
          </option><option
            v-for="item in optionItems.funding"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }}
          </option>
        </select>
      </FormField>
      <template v-if="draft.scope === 'EXPENSE'">
        <div class="form-grid-two">
          <FormField
            field-id="report-primary-category"
            label="一级分类"
          >
            <select
              id="report-primary-category"
              :value="draft.primaryCategoryId"
              @change="updatePrimaryCategory(($event.target as HTMLSelectElement).value)"
            >
              <option value="">
                全部一级分类
              </option><option
                v-for="item in rootCategories"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </FormField>
          <FormField
            field-id="report-secondary-category"
            label="二级分类"
          >
            <select
              id="report-secondary-category"
              v-model="draft.secondaryCategoryId"
              :disabled="!draft.primaryCategoryId"
            >
              <option :value="undefined">
                全部二级分类
              </option><option
                v-for="item in secondaryCategories"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </FormField>
        </div>
        <FormField
          field-id="report-product"
          label="商品"
        >
          <select
            id="report-product"
            v-model="draft.productId"
          >
            <option :value="undefined">
              全部商品
            </option><option
              v-for="item in optionItems.products"
              :key="item.id"
              :value="item.id"
            >
              {{ item.name }}
            </option>
          </select>
        </FormField>
        <div class="form-grid-two">
          <FormField
            field-id="report-purchase"
            label="购买渠道"
          >
            <select
              id="report-purchase"
              v-model="draft.purchaseChannelId"
            >
              <option :value="undefined">
                全部购买渠道
              </option><option
                v-for="item in optionItems.purchase"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </FormField>
          <FormField
            field-id="report-location"
            label="地点"
          >
            <select
              id="report-location"
              v-model="draft.locationLabelId"
            >
              <option :value="undefined">
                全部地点
              </option><option
                v-for="item in optionItems.locations"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </FormField>
        </div>
      </template>
      <template v-if="draft.scope === 'INCOME'">
        <div class="form-grid-two">
          <FormField
            field-id="report-income-category"
            label="收入分类"
          >
            <select
              id="report-income-category"
              v-model="draft.incomeCategoryId"
            >
              <option :value="undefined">
                全部收入分类
              </option><option
                v-for="item in optionItems.incomeCategories"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </FormField>
          <FormField
            field-id="report-payer"
            label="付款方"
          >
            <select
              id="report-payer"
              v-model="draft.payerId"
            >
              <option :value="undefined">
                全部付款方
              </option><option
                v-for="item in optionItems.payers"
                :key="item.id"
                :value="item.id"
              >
                {{ item.name }}
              </option>
            </select>
          </FormField>
        </div>
        <FormField
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
  </article>
</template>
