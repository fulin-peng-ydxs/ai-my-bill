<script setup lang="ts">
import { usePageActivity } from '../composables/usePageActivity'
import { useRefreshOnReturn } from '../composables/useRefreshOnReturn'
import { ArrowLeft } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import { upsertDailyTemplateFromLedger } from '../api/dailyTemplates'
import { getExpenseAdjustment, revokeExpenseAdjustment, type ExpenseAdjustmentResponse } from '../api/expenseAdjustments'
import { getExpense, type ExpenseResponse } from '../api/expenses'
import { getIncome, type IncomeResponse } from '../api/incomes'
import type { LedgerDateRange, LedgerFilters, LedgerItem } from '../api/ledgerEntries'
import { changeLedgerLifecycle, type LedgerLifecycleResponse } from '../api/ledgerLifecycle'
import DictionaryFilterPicker from '../components/DictionaryFilterPicker.vue'
import { useDictionaryFilterLabels } from '../composables/useDictionaryFilterLabels'
import PageHeading from '../components/PageHeading.vue'
import { hasFilterChanges } from '../domain/filterChanges'
import AppliedFilterBar, { type AppliedFilterSummary } from '../components/AppliedFilterBar.vue'
import AppDialog from '../components/AppDialog.vue'
import AppDrawer from '../components/AppDrawer.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import AppToast from '../components/AppToast.vue'
import DataExportAction from '../components/DataExportAction.vue'
import FilterSheet from '../components/FilterSheet.vue'
import DateTimeControl from '../components/DateTimeControl.vue'
import ExpenseEntryForm from '../components/ExpenseEntryForm.vue'
import ExpenseAdjustmentDetail from '../components/ExpenseAdjustmentDetail.vue'
import ExpenseAdjustmentForm from '../components/ExpenseAdjustmentForm.vue'
import FormField from '../components/FormField.vue'
import GlobalLedgerSearch from '../components/GlobalLedgerSearch.vue'
import IncrementalLedgerList from '../components/IncrementalLedgerList.vue'
import IncomeEntryForm from '../components/IncomeEntryForm.vue'
import LedgerContextActions from '../components/LedgerContextActions.vue'
import SegmentedControl from '../components/SegmentedControl.vue'
import { useIncrementalLedgerQuery } from '../composables/useIncrementalLedgerQuery'
import { ledgerScrollKey, readLedgerScroll, rememberLedgerScroll } from '../composables/ledgerNavigationMemory'
import { useLatestRequest } from '../composables/useLatestRequest'
import { requestDiscardChanges } from '../composables/unsavedChanges'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'
import { formatShanghaiDateTime } from '../domain/businessTime'
import {
  clearedLedgerFilters, ledgerLifecycleOptions, ledgerRangeOptions, ledgerRouteQuery, ledgerTypeOptions, optionLabel, parseLedgerRoute,
  type LedgerDrillContext,
} from '../domain/ledgerQuery'
import { usePreferencesStore } from '../stores/preferences'
import { useSessionStore } from '../stores/session'

const pageActive = usePageActivity()
const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const session = useSessionStore()
const list = useIncrementalLedgerQuery()
const editRequest = useLatestRequest<ExpenseResponse | IncomeResponse>()
const adjustmentRequest = useLatestRequest<ExpenseAdjustmentResponse>()
const searchText = ref('')
const filters = ref<LedgerFilters>({ query: '', type: 'ALL', lifecycle: 'ACTIVE', range: 'TODAY' })
const draft = ref<LedgerFilters>({ ...filters.value })
const filterOpen = ref(false)
const focusedFilter = ref<'range' | 'type' | 'fundingChannelId'>()
const rangeError = ref('')
const contextItem = ref<LedgerItem>()
const contextOpen = ref(false)
const contextBusy = ref(false)
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const editOpen = ref(false)
const editTarget = ref<LedgerItem>()
const adjustmentSource = ref<LedgerItem>()
const adjustmentOpen = ref(false)
const adjustmentTarget = ref<LedgerItem>()
const adjustmentDetailOpen = ref(false)
const revokeConfirmOpen = ref(false)
const revoking = ref(false)
const revokeAttempt = createIdempotencyAttemptTracker()
const lifecycleAttempt = createIdempotencyAttemptTracker()
const lifecycleBusyId = ref('')
const pendingUndo = ref<LedgerLifecycleResponse>()
const purgeTarget = ref<LedgerItem>()
const purgeConfirmOpen = ref(false)
const trashDetailTarget = ref<LedgerItem>()
const trashDetailOpen = ref(false)

const defaultRange = computed<LedgerDateRange>(() => preferences.values.ledgerDefaultRange)
const hasFilters = computed(() => hasFilterChanges(filters.value, clearedLedgerFilters(defaultRange.value, filters.value.lifecycle)))
const parsed = computed(() => parseLedgerRoute(route.query, defaultRange.value))
const drill = computed(() => parsed.value.drill)
const filterName = useDictionaryFilterLabels(() => ({ fundingChannelId: filters.value.fundingChannelId }))
const filterSummaries = computed<AppliedFilterSummary[]>(() => [
  { key: 'range', label: '日期', value: filters.value.range === 'CUSTOM' ? `${filters.value.startDate} 至 ${filters.value.endDate}` : optionLabel(ledgerRangeOptions, filters.value.range) },
  ...(filters.value.type === 'ALL' ? [] : [{ key: 'type', label: '类型', value: optionLabel(ledgerTypeOptions, filters.value.type) }]),
  ...(filters.value.fundingChannelId ? [{ key: 'fundingChannelId', label: '资金渠道', value: filterName('fundingChannelId') ?? '指定选项' }] : []),
])
const filterTitle = computed(() => focusedFilter.value
  ? `修改${filterSummaries.value.find(item => item.key === focusedFilter.value)?.label ?? '筛选条件'}` : '筛选收支明细')
function openFilters(key?: string): void {
  focusedFilter.value = key as typeof focusedFilter.value
  draft.value = { ...filters.value }
  rangeError.value = ''
  filterOpen.value = true
}
function showFilter(key: NonNullable<typeof focusedFilter.value>): boolean {
  return filterOpen.value && (!focusedFilter.value || focusedFilter.value === key)
}
const currentScrollKey = computed(() => ledgerScrollKey(session.session?.accountId ?? '', route.fullPath))
const exportRequest = computed(() => ({ scope: 'CURRENT_FILTERS' as const, ...filters.value }))

function showExportNotice(message: string, kind: 'success' | 'error'): void {
  pendingUndo.value = undefined
  toastMessage.value = message
  toastKind.value = kind
  toastOpen.value = true
}

watch([() => route.fullPath, () => preferences.status], async () => {
  if (preferences.status === 'idle' || preferences.status === 'loading') return
  filters.value = { ...parsed.value.filters }
  searchText.value = filters.value.query
  draft.value = { ...filters.value }
  await list.replace(filters.value)
  const saved = readLedgerScroll(currentScrollKey.value)
  await nextTick(() => { if (pageActive.value) globalThis.scrollTo({ top: saved ?? 0 }) })
}, { immediate: true })

function navigate(next: LedgerFilters): void {
  void router.replace({ query: ledgerRouteQuery(next, drill.value) })
}

function updateSearch(value: string): void {
  navigate({ ...filters.value, query: value })
}

function updateLifecycle(value: string): void {
  navigate({ ...filters.value, lifecycle: value as LedgerFilters['lifecycle'] })
}

function clearFilters(): void {
  navigate(clearedLedgerFilters(defaultRange.value, filters.value.lifecycle))
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

const contextActions = computed(() => {
  if (!contextItem.value) return []
  if (contextItem.value.lifecycleStatus === 'TRASHED') return [
    { key: 'restore', label: '恢复到账目' },
    { key: 'purge', label: contextItem.value.linkedAdjustmentCount
      ? `永久删除并联动清理 ${contextItem.value.linkedAdjustmentCount} 条调整` : '永久删除', danger: true },
  ]
  if (contextItem.value.entryType === 'ADJUSTMENT') return [
    { key: 'detail', label: '查看调整详情' }, { key: 'trash', label: '移入回收站', danger: true },
  ]
  return [
    { key: 'daily', label: contextBusy.value ? '正在加入日常…' : '加入或更新日常模板', disabled: contextBusy.value },
    ...(contextItem.value.entryType === 'EXPENSE' ? [{ key: 'adjust', label: '记录退款/报销' }] : []),
    { key: 'trash', label: '移入回收站', danger: true },
  ]
})

function loadEdit(): void {
  const item = editTarget.value
  if (!item) return
  void editRequest.execute(
    (signal) => item.entryType === 'EXPENSE' ? getExpense(item.id, signal) : getIncome(item.id, signal),
    { intent: 'replace' },
  )
}

function openEdit(item: LedgerItem): void {
  if (item.lifecycleStatus === 'TRASHED') {
    trashDetailTarget.value = item
    trashDetailOpen.value = true
    return
  }
  if (item.entryType === 'ADJUSTMENT') { openAdjustmentDetail(item); return }
  editTarget.value = item
  editOpen.value = true
  loadEdit()
}

function openAdjustmentDetail(item: LedgerItem): void {
  adjustmentTarget.value = item
  adjustmentDetailOpen.value = true
  void adjustmentRequest.execute((signal) => getExpenseAdjustment(item.id, signal), { intent: 'replace' })
}

function openAdjustmentForm(item: LedgerItem): void {
  adjustmentSource.value = item
  adjustmentOpen.value = true
}

async function requestAdjustmentOpen(value: boolean): Promise<void> {
  if (value) { adjustmentOpen.value = true; return }
  if (await requestDiscardChanges('navigation')) adjustmentOpen.value = false
}

async function adjustmentSaved(): Promise<void> {
  adjustmentOpen.value = false
  pendingUndo.value = undefined
  toastKind.value = 'success'; toastMessage.value = '退款/报销调整已保存，原支出净额已更新。'; toastOpen.value = true
  await list.replace(filters.value)
}

async function confirmRevoke(): Promise<void> {
  const detail = adjustmentRequest.data.value
  if (!detail || revoking.value) return
  revoking.value = true
  try {
    const request = { id: detail.id, version: detail.version }
    adjustmentRequest.data.value = await revokeExpenseAdjustment(detail.id, detail.version, revokeAttempt.keyFor(request))
    revokeAttempt.reset(); revokeConfirmOpen.value = false
    pendingUndo.value = undefined
    toastKind.value = 'success'; toastMessage.value = '调整已撤销，原支出净额已恢复。'; toastOpen.value = true
    await list.replace(filters.value)
  } catch (cause) {
    toastKind.value = 'error'; toastMessage.value = cause instanceof Error ? cause.message : '撤销调整失败，请重试。'; toastOpen.value = true
  } finally { revoking.value = false }
}

async function requestEditOpen(value: boolean): Promise<void> {
  if (value) { editOpen.value = true; return }
  if (await requestDiscardChanges('navigation')) editOpen.value = false
}

async function manageDetail(source: 'edit' | 'trash' | 'adjustment'): Promise<void> {
  const item = source === 'edit' ? editTarget.value : source === 'trash' ? trashDetailTarget.value : adjustmentTarget.value
  if (!item) return
  if (source === 'edit') {
    await requestEditOpen(false)
    if (editOpen.value) return
  } else if (source === 'trash') trashDetailOpen.value = false
  else adjustmentDetailOpen.value = false
  await nextTick()
  openContext(item)
}

async function editSaved(value: ExpenseResponse | IncomeResponse): Promise<void> {
  editOpen.value = false
  pendingUndo.value = undefined
  toastKind.value = 'success'
  toastMessage.value = `${'productName' in value ? '支出' : '收入'}修改已保存。`
  toastOpen.value = true
  await list.replace(filters.value)
}

async function contextAction(key: string): Promise<void> {
  if (!contextItem.value || contextBusy.value) return
  if (key === 'adjust' && contextItem.value.entryType === 'EXPENSE') {
    const item = contextItem.value; contextOpen.value = false; openAdjustmentForm(item); return
  }
  if (key === 'detail' && contextItem.value.entryType === 'ADJUSTMENT') {
    const item = contextItem.value; contextOpen.value = false; openAdjustmentDetail(item); return
  }
  if (key === 'trash' || key === 'restore') {
    const item = contextItem.value; contextOpen.value = false
    await runLifecycle(item, key)
    return
  }
  if (key === 'purge') {
    purgeTarget.value = contextItem.value; contextOpen.value = false; purgeConfirmOpen.value = true
    return
  }
  if (key !== 'daily' || contextItem.value.entryType === 'ADJUSTMENT') return
  contextBusy.value = true
  try {
    await upsertDailyTemplateFromLedger(contextItem.value.id)
    pendingUndo.value = undefined
    toastMessage.value = `“${contextItem.value.title}”已加入日常`
    toastKind.value = 'success'
    contextOpen.value = false
    toastOpen.value = true
  } catch (cause) {
    pendingUndo.value = undefined
    toastMessage.value = cause instanceof Error ? cause.message : '加入日常失败，请重试。'
    toastKind.value = 'error'
    toastOpen.value = true
  } finally {
    contextBusy.value = false
  }
}

async function runLifecycle(item: Pick<LedgerItem, 'id' | 'entryType' | 'version'>,
  action: 'trash' | 'restore'): Promise<void> {
  if (lifecycleBusyId.value) return
  lifecycleBusyId.value = item.id
  try {
    const request = { id: item.id, entryType: item.entryType, version: item.version, action }
    const result = await changeLedgerLifecycle(item, action, lifecycleAttempt.keyFor(request))
    lifecycleAttempt.reset()
    if (action === 'trash' && result) {
      pendingUndo.value = result
      toastMessage.value = '账目已移入回收站，相关统计已更新。'
    } else {
      pendingUndo.value = undefined
      toastMessage.value = '账目已恢复，相关调整与统计已更新。'
    }
    toastKind.value = 'success'; toastOpen.value = true
    await list.replace(filters.value)
  } catch (cause) {
    toastMessage.value = cause instanceof Error ? cause.message : '账目状态更新失败，请重试。'
    toastKind.value = 'error'; toastOpen.value = true
  } finally { lifecycleBusyId.value = '' }
}

async function undoTrash(): Promise<void> {
  const item = pendingUndo.value
  if (!item) return
  await runLifecycle({ id: item.id, entryType: item.entryType as LedgerItem['entryType'], version: item.version }, 'restore')
}

async function confirmPurge(): Promise<void> {
  const item = purgeTarget.value
  if (!item || lifecycleBusyId.value) return
  lifecycleBusyId.value = item.id
  try {
    const request = { id: item.id, entryType: item.entryType, version: item.version, action: 'purge' }
    await changeLedgerLifecycle(item, 'purge', lifecycleAttempt.keyFor(request))
    lifecycleAttempt.reset(); purgeConfirmOpen.value = false; purgeTarget.value = undefined
    pendingUndo.value = undefined
    toastKind.value = 'success'; toastMessage.value = '账目已永久删除，无法恢复。'; toastOpen.value = true
    await list.replace(filters.value)
  } catch (cause) {
    toastKind.value = 'error'; toastMessage.value = cause instanceof Error ? cause.message : '永久删除失败，请重试。'; toastOpen.value = true
  } finally { lifecycleBusyId.value = '' }
}

function returnToReports(context: LedgerDrillContext): void {
  void router.push({ path: '/reports', query: context.reportQuery })
}

onBeforeRouteLeave(() => { rememberLedgerScroll(currentScrollKey.value, globalThis.scrollY) })
onBeforeUnmount(() => { editRequest.cancel(); adjustmentRequest.cancel() })
useRefreshOnReturn(() => list.refresh())
</script>

<template>
  <article
    class="ledger-page"
    data-page-key="bill-details"
  >
    <PageHeading
      title="收支明细"
      :subtitle="filters.lifecycle === 'TRASHED' ? '删除后 30 天内可恢复' : undefined"
    >
      <DataExportAction
        :request="exportRequest"
        @notify="showExportNotice"
      />
    </PageHeading>

    <section
      v-if="drill"
      class="drill-context"
      aria-label="报表下钻上下文"
    >
      <div><span>报表下钻</span><strong>{{ drill.dimension }} · {{ drill.label ?? drill.value }}</strong></div>
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
      :clearable="hasFilters"
      @open="openFilters()"
      @edit="openFilters"
      @clear="clearFilters"
    />

    <section
      class="ledger-controls"
      aria-label="明细视图控制"
    >
      <div>
        <SegmentedControl
          label="账目状态"
          :model-value="filters.lifecycle"
          :options="ledgerLifecycleOptions"
          @update:model-value="updateLifecycle"
        />
      </div>
      <p class="ledger-gesture-hint">
        <span class="touch-hint">轻点查看 · 左滑或长按管理</span><span class="pointer-hint">点击查看 · 右键管理</span>
      </p>
    </section>

    <AppStateBlock
      v-if="list.error.value && (list.status.value === 'ready' || list.status.value === 'empty')"
      kind="error"
      :title="list.lastOperation.value === 'refresh' ? '明细刷新未完成' : '更多明细加载失败'"
      :message="list.error.value.message"
      action-label="重试"
      @action="list.retry"
    />
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
      :title="hasFilters ? '没有匹配的明细' : filters.lifecycle === 'ACTIVE' ? '这段时间还没有记录' : '回收站为空'"
      :message="hasFilters ? '试试调整日期、类型或搜索内容。' : filters.lifecycle === 'ACTIVE' ? '记下一笔，或通过筛选查看其他日期。' : '删除的账目会在这里保留 30 天。'"
      :action-label="hasFilters ? '清除筛选' : filters.lifecycle === 'ACTIVE' ? '记一笔' : undefined"
      @action="hasFilters ? clearFilters() : router.push('/entry')"
    />
    <template v-else>
      <IncrementalLedgerList
        :items="list.items.value"
        :type="filters.type"
        :has-more="list.hasMore.value"
        :loading-more="list.loadingMore.value"
        :lifecycle="filters.lifecycle"
        :busy-item-id="lifecycleBusyId"
        @more="list.more"
        @context="openContext"
        @open="openEdit"
      />
    </template>

    <FilterSheet
      id="ledger-filter"
      v-model:open="filterOpen"
      :title="filterTitle"
      :apply-label="focusedFilter ? '确定' : '应用筛选'"
      @apply="applyFilters"
    >
      <div :class="focusedFilter ? undefined : 'form-grid-two entry-short-fields'">
        <FormField
          v-if="showFilter('range')"
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
        <FormField
          v-if="showFilter('type')"
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
      </div>
      <div
        v-if="showFilter('range') && draft.range === 'CUSTOM'"
        class="custom-date-range"
      >
        <FormField
          field-id="ledger-start-date"
          label="开始日期"
        >
          <DateTimeControl
            id="ledger-start-date"
            v-model="draft.startDate"
            :aria-describedby="rangeError ? 'ledger-range-error' : undefined"
            :aria-invalid="Boolean(rangeError)"
            type="date"
          />
        </FormField>
        <FormField
          field-id="ledger-end-date"
          label="结束日期"
        >
          <DateTimeControl
            id="ledger-end-date"
            v-model="draft.endDate"
            :aria-describedby="rangeError ? 'ledger-range-error' : undefined"
            :aria-invalid="Boolean(rangeError)"
            type="date"
          />
        </FormField>
      </div>
      <DictionaryFilterPicker
        v-if="showFilter('fundingChannelId')"
        id="ledger-funding"
        v-model="draft.fundingChannelId"
        type="funding-channel"
        label="资金渠道"
      />
    </FilterSheet>

    <LedgerContextActions
      id="ledger-context-actions"
      v-model:open="contextOpen"
      :title="contextItem ? `管理“${contextItem.title}”` : '账目操作'"
      :actions="contextActions"
      :description="contextItem?.lifecycleStatus === 'TRASHED' ? '恢复会重新计入统计；永久删除不可恢复。' : '选择要对这条有效账目执行的操作。'"
      @select="contextAction"
    />
    <AppDrawer
      id="trash-ledger-detail"
      v-model:open="trashDetailOpen"
      :title="trashDetailTarget ? `查看“${trashDetailTarget.title}”` : '查看回收站账目'"
      description="这里只展示删除前的账目信息；恢复或永久删除请打开更多操作。"
    >
      <template #footer>
        <button
          type="button"
          class="compact-action"
          @click="manageDetail('trash')"
        >
          更多操作
        </button>
      </template>
      <dl
        v-if="trashDetailTarget"
        class="adjustment-metadata"
      >
        <div><dt>账目类型</dt><dd>{{ trashDetailTarget.entryType === 'EXPENSE' ? '支出' : trashDetailTarget.entryType === 'INCOME' ? '收入' : trashDetailTarget.adjustmentType === 'REFUND' ? '退款' : '报销' }}</dd></div>
        <div><dt>业务时间</dt><dd>{{ formatShanghaiDateTime(trashDetailTarget.occurredAt) }}</dd></div>
        <div><dt>金额</dt><dd>¥{{ trashDetailTarget.amount }}</dd></div>
        <div><dt>分类</dt><dd>{{ trashDetailTarget.categoryName }}</dd></div>
        <div><dt>对象</dt><dd>{{ trashDetailTarget.counterpartyName }}</dd></div>
        <div><dt>资金渠道</dt><dd>{{ trashDetailTarget.fundingChannelName }}</dd></div>
        <div><dt>恢复期限</dt><dd>{{ trashDetailTarget.remainingDays === 0 ? '今天到期' : `剩余 ${trashDetailTarget.remainingDays} 天` }}</dd></div>
        <div v-if="trashDetailTarget.linkedAdjustmentCount">
          <dt>关联调整</dt><dd>恢复后重生效；永久删除将联动清理 {{ trashDetailTarget.linkedAdjustmentCount }} 条</dd>
        </div>
        <div v-if="trashDetailTarget.note">
          <dt>备注</dt><dd>{{ trashDetailTarget.note }}</dd>
        </div>
      </dl>
    </AppDrawer>
    <AppDrawer
      id="ledger-edit"
      :open="editOpen"
      :title="editTarget?.entryType === 'EXPENSE' ? '编辑支出' : '编辑收入'"
      description="修改只作用于当前账目；账目类型不可转换。"
      @update:open="requestEditOpen"
    >
      <template #footer>
        <button
          type="button"
          class="compact-action"
          @click="manageDetail('edit')"
        >
          更多操作
        </button>
      </template>
      <AppStateBlock
        v-if="editRequest.status.value === 'loading'"
        kind="loading"
        title="正在加载账目详情"
      />
      <AppStateBlock
        v-else-if="editRequest.status.value === 'error'"
        kind="error"
        title="账目详情加载失败"
        :message="editRequest.error.value?.message"
        action-label="重试"
        @action="loadEdit"
      />
      <ExpenseEntryForm
        v-else-if="editRequest.data.value && 'productName' in editRequest.data.value"
        :key="`${editRequest.data.value.id}:${editRequest.data.value.version}`"
        :account-id="session.session?.accountId"
        :edit-entry="editRequest.data.value"
        @saved="editSaved"
      />
      <IncomeEntryForm
        v-else-if="editRequest.data.value"
        :key="`${editRequest.data.value.id}:${editRequest.data.value.version}`"
        :account-id="session.session?.accountId"
        :edit-entry="editRequest.data.value"
        @saved="editSaved"
      />
    </AppDrawer>
    <AppDrawer
      id="expense-adjustment-create"
      :open="adjustmentOpen"
      title="记录退款/报销"
      description="调整会冲减所选原支出的净额，不计入收入。"
      @update:open="requestAdjustmentOpen"
    >
      <ExpenseAdjustmentForm
        v-if="adjustmentSource"
        :key="adjustmentSource.id"
        :source="adjustmentSource"
        @saved="adjustmentSaved"
      />
    </AppDrawer>
    <AppDrawer
      id="expense-adjustment-detail"
      :open="adjustmentDetailOpen"
      title="调整详情"
      description="已撤销记录仍保留，用于还原调整轨迹。"
      @update:open="adjustmentDetailOpen = $event"
    >
      <template #footer>
        <button
          type="button"
          class="compact-action"
          :disabled="revoking"
          @click="manageDetail('adjustment')"
        >
          更多操作
        </button>
      </template>
      <AppStateBlock
        v-if="adjustmentRequest.status.value === 'loading'"
        kind="loading"
        title="正在加载调整详情"
      />
      <AppStateBlock
        v-else-if="adjustmentRequest.status.value === 'error'"
        kind="error"
        title="调整详情加载失败"
        :message="adjustmentRequest.error.value?.message"
        action-label="重试"
        @action="adjustmentTarget && openAdjustmentDetail(adjustmentTarget)"
      />
      <ExpenseAdjustmentDetail
        v-else-if="adjustmentRequest.data.value"
        :adjustment="adjustmentRequest.data.value"
        :busy="revoking"
        @revoke="revokeConfirmOpen = true"
      />
    </AppDrawer>
    <AppDialog
      id="purge-ledger"
      v-model:open="purgeConfirmOpen"
      title="确认永久删除？"
      :description="purgeTarget?.linkedAdjustmentCount ? `原账目及关联的 ${purgeTarget.linkedAdjustmentCount} 条调整会在同一操作中永久删除，且无法恢复。` : '该记录将被永久删除，且无法恢复。'"
      confirm-label="永久删除"
      :busy="Boolean(lifecycleBusyId)"
      danger
      @confirm="confirmPurge"
    />
    <AppDialog
      id="revoke-adjustment"
      v-model:open="revokeConfirmOpen"
      title="确认撤销这笔调整？"
      description="撤销后该金额不再冲减原支出，但调整记录会保留。"
      confirm-label="确认撤销"
      :busy="revoking"
      danger
      @confirm="confirmRevoke"
    />
    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
      :action-label="pendingUndo && toastKind === 'success' ? '撤销' : undefined"
      :action-disabled="Boolean(lifecycleBusyId)"
      @action="undoTrash"
    />
  </article>
</template>
