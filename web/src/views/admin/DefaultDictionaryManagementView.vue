<script setup lang="ts">
import { useRefreshOnReturn } from '../../composables/useRefreshOnReturn'
import { Plus } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'

import {
  changeDefaultDictionaryItemStatus,
  createDefaultDictionaryItem,
  listDefaultDictionaryItems,
  listDefaultDictionarySummaries,
  moveDefaultDictionaryItem,
  type DefaultDictionaryItem,
  type DefaultDictionaryStatus,
  type DefaultDictionaryType,
} from '../../api/defaultDictionaries'
import { isAccessDenied, normalizeRequestError, type RequestError } from '../../api/errors'
import AppDialog from '../../components/AppDialog.vue'
import AppDrawer from '../../components/AppDrawer.vue'
import DictionaryListFooter from '../../components/DictionaryListFooter.vue'
import AppAsyncRegion from '../../components/AppAsyncRegion.vue'
import AppStatusNotice from '../../components/AppStatusNotice.vue'
import AppRequestError from '../../components/AppRequestError.vue'
import AppStateBlock from '../../components/AppStateBlock.vue'
import AppToast from '../../components/AppToast.vue'
import DictionaryCombobox, { type DictionaryChoice } from '../../components/DictionaryCombobox.vue'
import DictionaryItemList, { type DictionaryListItem } from '../../components/DictionaryItemList.vue'
import DictionaryToolbar from '../../components/DictionaryToolbar.vue'
import FormField from '../../components/FormField.vue'
import { useLatestRequest } from '../../composables/useLatestRequest'
import type { ReorderMove } from '../../components/ReorderList.vue'
import { DICTIONARY_PAGE_SIZE } from '../../domain/dictionaries'
import { defaultDictionaryDefinition, defaultDictionaryDefinitions } from '../../domain/defaultDictionaries'

const selectedType = ref<DefaultDictionaryType>('expense-category')
const definition = computed(() => defaultDictionaryDefinition(selectedType.value))
const queryDraft = ref('')
const appliedQuery = ref('')
const statusFilter = ref<DefaultDictionaryStatus | ''>('')
const pageIndex = ref(0)
const selected = ref<DefaultDictionaryItem>()
const actionsOpen = ref(false)
const statusConfirmOpen = ref(false)
const createOpen = ref(false)
const createName = ref('')
const createParentId = ref('')
const createError = ref('')
const busy = ref(false)
const activeRoots = ref<DefaultDictionaryItem[]>([])
const parentStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const parentError = ref<RequestError>()
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const summaryRequest = useLatestRequest<Awaited<ReturnType<typeof listDefaultDictionarySummaries>>>()
const { data, status, error, staleWarning, refreshing, execute, cancel } = useLatestRequest<Awaited<ReturnType<typeof listDefaultDictionaryItems>>>(() => {
  selected.value = undefined
  actionsOpen.value = false
  statusConfirmOpen.value = false
  createOpen.value = false
})

const items = computed(() => data.value?.items ?? [])

async function load(intent: 'replace' | 'refresh' = 'replace'): Promise<void> {
  await execute(
    (signal) => listDefaultDictionaryItems(
      selectedType.value, appliedQuery.value, statusFilter.value, signal, pageIndex.value, DICTIONARY_PAGE_SIZE,
    ),
    { intent: intent === 'refresh' ? 'silent' : 'replace', isEmpty: (page) => page.items.length === 0 },
  )
}

async function loadSummaries(): Promise<void> {
  await summaryRequest.execute((signal) => listDefaultDictionarySummaries(signal))
}

function search(value: string): void {
  appliedQuery.value = value.trim()
  pageIndex.value = 0
  void load()
}

function openActions(item: DictionaryListItem): void {
  selected.value = items.value.find((candidate) => candidate.id === item.id)
  actionsOpen.value = true
}

async function openCreate(): Promise<void> {
  createName.value = ''
  createParentId.value = ''
  createError.value = ''
  activeRoots.value = []
  parentStatus.value = definition.value.hierarchical ? 'loading' : 'idle'
  createOpen.value = true
  if (definition.value.hierarchical) await loadParentOptions()
}

async function loadParentOptions(): Promise<void> {
  parentStatus.value = 'loading'
  parentError.value = undefined
  activeRoots.value = []
  try {
    let currentPage = 0
    let total = 0
    do {
      const page = await listDefaultDictionaryItems(selectedType.value, '', 'ACTIVE', undefined, currentPage, 100)
      activeRoots.value.push(...page.items.filter((item) => !item.parentId))
      total = page.total
      currentPage += 1
    } while (currentPage * 100 < total)
    parentStatus.value = 'ready'
  } catch (cause) {
    parentStatus.value = 'error'
    parentError.value = normalizeRequestError(cause)
  }
}

async function searchDefaultRoots(query: string, signal: globalThis.AbortSignal): Promise<DictionaryChoice[]> {
  const roots: DictionaryChoice[] = []
  let pageIndex = 0
  let total = 0
  do {
    const page = await listDefaultDictionaryItems('expense-category', query, 'ACTIVE', signal, pageIndex, 100)
    roots.push(...page.items.filter((item) => !item.parentId))
    total = page.total
    pageIndex += 1
  } while (pageIndex * 100 < total)
  return roots
}
async function createDefaultRoot(name: string): Promise<DictionaryChoice> {
  const item = await createDefaultDictionaryItem('expense-category', name)
  activeRoots.value = [item, ...activeRoots.value]
  return item
}

async function submitCreate(): Promise<void> {
  const name = createName.value.trim()
  createError.value = ''
  if (!name || [...name].length > 100) {
    createError.value = '请输入 1-100 个字符。'
    return
  }
  if (definition.value.hierarchical && parentStatus.value !== 'ready') return
  busy.value = true
  try {
    await createDefaultDictionaryItem(selectedType.value, name, createParentId.value || undefined)
    createOpen.value = false
    showToast('默认项已新增，只供以后创建的用户复制')
    await Promise.all([load('refresh'), loadSummaries()])
  } catch (cause) {
    const requestError = normalizeRequestError(cause)
    createError.value = requestError.fieldErrors.name?.[0] ?? requestError.fieldErrors.parentId?.[0] ?? requestError.message
  } finally {
    busy.value = false
  }
}

async function mutateSelected(): Promise<void> {
  if (!selected.value || busy.value) return
  busy.value = true
  try {
    const next = selected.value.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    selected.value = await changeDefaultDictionaryItemStatus(selectedType.value, selected.value.id, next)
    showToast(next === 'ACTIVE' ? '默认项已恢复，将复制给新用户' : '默认项已停用，已有用户不受影响')
    statusConfirmOpen.value = false
    actionsOpen.value = false
    await Promise.all([load('refresh'), loadSummaries()])
  } catch (cause) {
    showToast(normalizeRequestError(cause).message, 'error')
  } finally { busy.value = false }
}

async function reorder(move: ReorderMove): Promise<void> {
  if (busy.value) return
  const type = selectedType.value
  if (!type) return
  busy.value = true
  try {
    await moveDefaultDictionaryItem(type, move.id, move.direction, move.targetId)
    if (selectedType.value !== type) return
    await load('refresh')
    showToast('顺序已更新')
  } catch (cause) {
    if (selectedType.value !== type) return
    showToast(normalizeRequestError(cause).message, 'error')
    if (selectedType.value !== type) return
    await load('refresh')
  } finally { busy.value = false }
}

function requestStatusChange(): void {
  if (!selected.value || busy.value) return
  if (selected.value.status === 'ACTIVE') {
    statusConfirmOpen.value = true
  } else void mutateSelected()
}

function clearConditionsOrCreate(): void {
  if (appliedQuery.value || statusFilter.value) {
    queryDraft.value = ''
    appliedQuery.value = ''
    statusFilter.value = ''
    pageIndex.value = 0
    void load()
  } else void openCreate()
}

function showToast(message: string, kind: 'success' | 'error' = 'success'): void {
  toastMessage.value = message
  toastKind.value = kind
  toastOpen.value = true
}

watch(selectedType, () => {
  cancel()
  queryDraft.value = ''
  appliedQuery.value = ''
  statusFilter.value = ''
  pageIndex.value = 0
  selected.value = undefined
  void load()
})
watch(statusFilter, () => {
  pageIndex.value = 0
  void load()
})

onMounted(() => void Promise.all([load(), loadSummaries()]))
useRefreshOnReturn(() => Promise.all([load('refresh'), loadSummaries()]).then(() => undefined))
</script>

<template>
  <section class="admin-default-dictionaries-page">
    <header class="admin-page-heading">
      <div>
        <h1>默认字典</h1>
        <p>维护新用户首次创建时获得的候选项，不会覆盖任何已有用户的个人字典。</p>
      </div>
      <button
        type="button"
        class="primary-button"
        @click="openCreate"
      >
        <Plus
          :size="18"
          aria-hidden="true"
        /> 新增{{ definition.singular }}
      </button>
    </header>

    <div class="default-scope-note">
      <strong>生效范围</strong>
      <span>只影响此后创建的用户；存量用户及其历史记录保持不变。</span>
    </div>

    <div class="default-type-picker">
      <label for="default-dictionary-type">维护类别</label>
      <select
        id="default-dictionary-type"
        v-model="selectedType"
      >
        <option
          v-for="item in defaultDictionaryDefinitions"
          :key="item.type"
          :value="item.type"
        >
          {{ item.label }}<template v-if="summaryRequest.data.value?.items.find((summary) => summary.type === item.type)">
            · {{ summaryRequest.data.value.items.find((summary) => summary.type === item.type)?.active }} 启用
          </template>
        </option>
      </select>
    </div>

    <span
      v-if="summaryRequest.status.value === 'loading'"
      role="status"
    >正在读取各类数量…</span>
    <AppStatusNotice
      v-else-if="summaryRequest.error.value"
      title="各类数量暂不可用"
      :error="summaryRequest.error.value"
      action-label="重试"
      @action="loadSummaries"
    />

    <DictionaryToolbar
      v-model:query="queryDraft"
      v-model:status="statusFilter"
      :label="definition.label"
      :total="status === 'ready' || status === 'empty' ? data?.total : undefined"
      :page="pageIndex"
      :shown="status === 'ready' ? items.length : undefined"
      :refreshing="refreshing || status === 'loading' || isAccessDenied(error)"
      @search="search"
      @refresh="load('refresh')"
    />

    <AppAsyncRegion
      :status="status"
      :error="error"
      :stale-warning="staleWarning"
      :refreshing="refreshing"
      :loading-title="`正在加载${definition.label}`"
      loading-message="这里只读取系统默认项，不访问用户数据。"
      :error-title="`${definition.label}暂不可用`"
      :empty-title="appliedQuery || statusFilter ? '没有匹配项' : `${definition.label}还是空的`"
      :empty-message="appliedQuery || statusFilter ? '清除搜索和状态条件后重试。' : '新增后，只会随以后创建的用户生成个人副本。'"
      :empty-action-label="appliedQuery || statusFilter ? '清除条件' : '新增默认项'"
      @retry="load()"
      @stale-retry="load('refresh')"
      @empty-action="clearConditionsOrCreate"
    >
      <DictionaryItemList
        :items="items"
        :label="definition.label"
        :busy="busy || refreshing"
        @move="reorder"
        @select="openActions"
      />

      <DictionaryListFooter
        v-if="status === 'ready'"
        :page="pageIndex"
        :total="data?.total ?? 0"
        :label="definition.label"
        :busy="refreshing"
        @update:page="pageIndex = $event; load()"
      />
    </AppAsyncRegion>

    <AppDrawer
      id="default-dictionary-actions"
      v-model:open="actionsOpen"
      :busy="busy"
      :title="selected?.name ?? '默认项操作'"
      description="排序和状态只改变后来创建用户的初始化副本。"
    >
      <div
        v-if="selected"
        class="context-action-list"
      >
        <button
          type="button"
          :disabled="busy"
          @click="requestStatusChange"
        >
          {{ selected.status === 'ACTIVE' ? '停用' : '恢复' }}
        </button>
      </div>
    </AppDrawer>

    <AppDialog
      id="default-dictionary-status-confirm"
      v-model:open="statusConfirmOpen"
      :title="`停用${selected?.name ?? '此选项'}？`"
      description="停用后不再复制给新用户；已有用户的选项和历史记录保持不变。"
      confirm-label="停用"
      :busy="busy"
      @confirm="mutateSelected"
    />

    <AppDialog
      id="create-default-dictionary"
      v-model:open="createOpen"
      :title="`新增${definition.singular}`"
      description="新增项只会复制给以后创建的用户。"
      confirm-label="新增默认项"
      :busy="busy"
      :confirm-disabled="definition.hierarchical && parentStatus !== 'ready'"
      @confirm="submitCreate"
    >
      <div class="dictionary-editor-form">
        <AppStateBlock
          v-if="definition.hierarchical && parentStatus === 'loading'"
          kind="loading"
          title="正在加载一级分类"
        />
        <AppRequestError
          v-else-if="definition.hierarchical && parentStatus === 'error'"
          title="一级分类暂不可用"
          :error="parentError"
          @retry="loadParentOptions"
        />
        <FormField
          field-id="default-dictionary-name"
          label="名称"
          help="最多 100 个字符；NFKC、空白和英文大小写等价名称不会重复创建。"
          :error="createError"
        >
          <template #default="{ describedBy }">
            <input
              id="default-dictionary-name"
              v-model="createName"
              maxlength="100"
              autocomplete="off"
              :aria-describedby="describedBy"
              @keydown.enter.prevent="submitCreate"
            >
          </template>
        </FormField>
        <DictionaryCombobox
          v-if="definition.hierarchical && parentStatus === 'ready'"
          input-id="default-dictionary-parent"
          :clear-on-input="false"
          type="expense-category"
          label="父分类"
          optional
          :items="activeRoots"
          :model-value="createParentId"
          :load-items="searchDefaultRoots"
          :create-item="createDefaultRoot"
          @select="createParentId = $event.id"
          @clear="createParentId = ''"
        />
      </div>
    </AppDialog>

    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
    />
  </section>
</template>
