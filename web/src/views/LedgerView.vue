<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import { upsertDailyTemplateFromLedger } from '../api/dailyTemplates'
import type { LedgerDateRange, LedgerFilters, LedgerItem } from '../api/ledgerEntries'
import { listDictionaryCandidates } from '../api/dictionaries'
import AppliedFilterBar from '../components/AppliedFilterBar.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import AppToast from '../components/AppToast.vue'
import FilterSheet from '../components/FilterSheet.vue'
import FormField from '../components/FormField.vue'
import GlobalLedgerSearch from '../components/GlobalLedgerSearch.vue'
import IncrementalLedgerList from '../components/IncrementalLedgerList.vue'
import LedgerContextActions from '../components/LedgerContextActions.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import { useIncrementalLedgerQuery } from '../composables/useIncrementalLedgerQuery'
import { ledgerScrollKey, readLedgerScroll, rememberLedgerScroll } from '../composables/ledgerNavigationMemory'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  clearedLedgerFilters, ledgerRangeOptions, ledgerRouteQuery, ledgerTypeOptions, optionLabel, parseLedgerRoute,
  type LedgerDrillContext,
} from '../domain/ledgerQuery'
import { usePreferencesStore } from '../stores/preferences'
import { useSessionStore } from '../stores/session'

const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const session = useSessionStore()
const list = useIncrementalLedgerQuery()
const fundingRequest = useLatestRequest<Awaited<ReturnType<typeof listDictionaryCandidates>>>()
const searchText = ref('')
const filters = ref<LedgerFilters>({ query: '', type: 'ALL', range: 'TODAY' })
const draft = ref<LedgerFilters>({ ...filters.value })
const filterOpen = ref(false)
const rangeError = ref('')
const contextItem = ref<LedgerItem>()
const contextOpen = ref(false)
const contextBusy = ref(false)
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')

const defaultRange = computed<LedgerDateRange>(() => preferences.values.ledgerDefaultRange)
const parsed = computed(() => parseLedgerRoute(route.query, defaultRange.value))
const drill = computed(() => parsed.value.drill)
const fundingItems = computed(() => fundingRequest.data.value?.items ?? [])
const filterSummaries = computed(() => [
  optionLabel(ledgerRangeOptions, filters.value.range),
  ...(filters.value.type === 'ALL' ? [] : [optionLabel(ledgerTypeOptions, filters.value.type)]),
  ...(filters.value.fundingChannelId ? [fundingItems.value.find((item) => item.id === filters.value.fundingChannelId)?.name ?? '指定资金渠道'] : []),
])
const currentScrollKey = computed(() => ledgerScrollKey(session.session?.accountId ?? '', route.fullPath))

watch([() => route.fullPath, () => preferences.status], async () => {
  if (preferences.status === 'idle' || preferences.status === 'loading') return
  filters.value = { ...parsed.value.filters }
  searchText.value = filters.value.query
  draft.value = { ...filters.value }
  await list.replace(filters.value)
  const saved = readLedgerScroll(currentScrollKey.value)
  await nextTick(() => globalThis.scrollTo({ top: saved ?? 0 }))
}, { immediate: true })

watch(filterOpen, (open) => {
  if (!open) return
  draft.value = { ...filters.value }
  rangeError.value = ''
  void fundingRequest.execute((signal) => listDictionaryCandidates('funding-channel', '', signal), {
    intent: fundingRequest.data.value ? 'refresh' : 'replace',
  })
})

function navigate(next: LedgerFilters): void {
  void router.replace({ query: ledgerRouteQuery(next, drill.value) })
}

function updateSearch(value: string): void {
  navigate({ ...filters.value, query: value })
}

function updateType(value: string): void {
  navigate({ ...filters.value, type: value as LedgerFilters['type'] })
}

function clearFilters(): void {
  navigate(clearedLedgerFilters(defaultRange.value))
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

function setDraftRange(value: LedgerDateRange): void {
  draft.value = { ...draft.value, range: value,
    ...(value === 'CUSTOM' ? {} : { startDate: undefined, endDate: undefined }) }
  rangeError.value = ''
}

function openContext(item: LedgerItem): void {
  contextItem.value = item
  contextOpen.value = true
}

async function contextAction(key: string): Promise<void> {
  if (key !== 'daily' || !contextItem.value || contextBusy.value) return
  contextBusy.value = true
  try {
    await upsertDailyTemplateFromLedger(contextItem.value.id)
    toastMessage.value = `“${contextItem.value.title}”已加入日常`
    toastKind.value = 'success'
    contextOpen.value = false
    toastOpen.value = true
  } catch (cause) {
    toastMessage.value = cause instanceof Error ? cause.message : '加入日常失败，请重试。'
    toastKind.value = 'error'
    toastOpen.value = true
  } finally {
    contextBusy.value = false
  }
}

function returnToReports(context: LedgerDrillContext): void {
  void router.push({ path: '/reports', query: context.reportQuery })
}

onBeforeRouteLeave(() => { rememberLedgerScroll(currentScrollKey.value, globalThis.scrollY) })
onBeforeUnmount(() => fundingRequest.cancel())
</script>

<template>
  <article
    class="ledger-page"
    data-page-key="bill-details"
  >
    <header class="page-heading ledger-page-heading">
      <div>
        <p class="eyebrow">
          有效账目
        </p>
        <h1>收支明细</h1>
        <p>按上海业务日期分组，稳定加载每一笔收支。</p>
      </div>
    </header>

    <section
      v-if="drill"
      class="drill-context"
      aria-label="报表下钻上下文"
    >
      <div><span>报表下钻</span><strong>{{ drill.dimension }} · {{ drill.value }}</strong></div>
      <button
        type="button"
        class="text-action"
        @click="returnToReports(drill)"
      >
        <ArrowLeft
          :size="17"
          aria-hidden="true"
        />返回报表
      </button>
    </section>

    <GlobalLedgerSearch
      id="ledger-search"
      v-model="searchText"
      @search="updateSearch"
    />
    <AppliedFilterBar
      :summaries="filterSummaries"
      @open="filterOpen = true"
      @clear="clearFilters"
    />

    <section
      class="ledger-controls"
      aria-label="明细视图控制"
    >
      <div>
        <span class="control-label">账目类型</span>
        <SegmentedControl
          label="账目类型"
          :model-value="filters.type"
          :options="ledgerTypeOptions"
          @update:model-value="updateType"
        />
      </div>
      <p>长按、右键或按 Shift+F10 管理有效账目</p>
    </section>

    <AppStateBlock
      v-if="list.status.value === 'loading'"
      kind="loading"
      title="正在加载收支明细"
    />
    <AppStateBlock
      v-else-if="list.status.value === 'error'"
      kind="error"
      title="收支明细加载失败"
      :message="list.error.value?.message"
      action-label="重试"
      @action="list.replace(filters)"
    />
    <AppStateBlock
      v-else-if="list.status.value === 'empty'"
      kind="empty"
      title="当前条件没有明细"
      message="调整账目类型、搜索内容、资金渠道或日期范围后重试。"
      action-label="清除筛选"
      @action="clearFilters"
    />
    <template v-else>
      <AppStateBlock
        v-if="list.error.value"
        kind="error"
        title="更多明细加载失败"
        :message="list.error.value.message"
        action-label="重试"
        @action="list.more"
      />
      <IncrementalLedgerList
        :items="list.items.value"
        :type="filters.type"
        :has-more="list.hasMore.value"
        :loading-more="list.loadingMore.value"
        @more="list.more"
        @context="openContext"
      />
    </template>

    <FilterSheet
      id="ledger-filter"
      v-model:open="filterOpen"
      title="筛选收支明细"
      @apply="applyFilters"
    >
      <FormField
        field-id="ledger-range"
        label="日期范围"
        :error="rangeError"
      >
        <select
          id="ledger-range"
          :value="draft.range"
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
      </FormField>
      <div
        v-if="draft.range === 'CUSTOM'"
        class="custom-date-range"
      >
        <FormField
          field-id="ledger-start-date"
          label="开始日期"
        >
          <input
            id="ledger-start-date"
            v-model="draft.startDate"
            type="date"
          >
        </FormField>
        <FormField
          field-id="ledger-end-date"
          label="结束日期"
        >
          <input
            id="ledger-end-date"
            v-model="draft.endDate"
            type="date"
          >
        </FormField>
      </div>
      <FormField
        field-id="ledger-filter-type"
        label="账目类型"
      >
        <select
          id="ledger-filter-type"
          v-model="draft.type"
        >
          <option
            v-for="option in ledgerTypeOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </FormField>
      <FormField
        field-id="ledger-funding"
        label="资金渠道"
      >
        <select
          id="ledger-funding"
          v-model="draft.fundingChannelId"
          :disabled="fundingRequest.status.value === 'loading'"
        >
          <option :value="undefined">
            全部渠道
          </option>
          <option
            v-for="item in fundingItems"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }}
          </option>
        </select>
      </FormField>
      <AppStateBlock
        v-if="fundingRequest.status.value === 'error'"
        kind="error"
        title="资金渠道加载失败"
        :message="fundingRequest.error.value?.message"
        action-label="重试"
        @action="fundingRequest.execute((signal) => listDictionaryCandidates('funding-channel', '', signal))"
      />
    </FilterSheet>

    <LedgerContextActions
      id="ledger-context-actions"
      v-model:open="contextOpen"
      :title="contextItem ? `管理“${contextItem.title}”` : '账目操作'"
      :actions="[{ key: 'daily', label: contextBusy ? '正在加入日常…' : '加入或更新日常模板', disabled: contextBusy }]"
      @select="contextAction"
    />
    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
    />
  </article>
</template>
