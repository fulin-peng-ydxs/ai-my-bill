<script setup lang="ts">
import PageWorkspace from '../../../components/PageWorkspace.vue'
import { scrollPageTo } from '../../../composables/pageScroll'
import { useRefreshOnReturn } from '../../../composables/useRefreshOnReturn'
import { ArrowLeft, Plus } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  changeDictionaryItemStatus,
  createDictionaryItem,
  listDictionaryItems,
  listDictionaryCandidates,
  mergeProduct,
  moveDictionaryItem,
  previewProductMerge,
  renameDictionaryItem,
  type DictionaryItem,
  type DictionaryStatus,
  type ProductMergePreview,
} from '../../../api/dictionaries'
import { isAccessDenied, normalizeRequestError, type RequestError } from '../../../api/errors'
import AppDialog from '../../../components/AppDialog.vue'
import AppDrawer from '../../../components/AppDrawer.vue'
import DictionaryListFooter from '../../../components/DictionaryListFooter.vue'
import AppAsyncRegion from '../../../components/AppAsyncRegion.vue'
import AppRequestError from '../../../components/AppRequestError.vue'
import AppStateBlock from '../../../components/AppStateBlock.vue'
import AppToast from '../../../components/AppToast.vue'
import DictionaryCombobox, { type DictionaryChoice } from '../../../components/DictionaryCombobox.vue'
import DictionaryItemList, { type DictionaryListItem } from '../../../components/DictionaryItemList.vue'
import DictionaryToolbar from '../../../components/DictionaryToolbar.vue'
import FormField from '../../../components/FormField.vue'
import GlobalLedgerSearch from '../../../components/GlobalLedgerSearch.vue'
import { useLatestRequest } from '../../../composables/useLatestRequest'
import { dictionaryIndexTarget } from '../../../domain/dictionaryNavigation'
import type { ReorderMove } from '../../../components/ReorderList.vue'
import { DICTIONARY_PAGE_SIZE, dictionaryDefinition } from '../../../domain/dictionaries'

type EditorMode = 'create' | 'rename'

const route = useRoute()
const router = useRouter()
const definition = computed(() => dictionaryDefinition(route.params.type))
const queryDraft = ref('')
const appliedQuery = ref('')
const statusFilter = ref<DictionaryStatus | ''>('')
const pageIndex = ref(0)
const selected = ref<DictionaryItem>()
const actionsOpen = ref(false)
const statusConfirmOpen = ref(false)
const editorOpen = ref(false)
const editorMode = ref<EditorMode>('create')
const editorName = ref('')
const editorParentId = ref('')
const activeRoots = ref<DictionaryItem[]>([])
const parentOptionsStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const parentOptionsError = ref<RequestError>()
const editorError = ref('')
const busy = ref(false)
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const mergeOpen = ref(false)
const mergeQuery = ref('')
const mergeCandidates = ref<DictionaryItem[]>([])
const mergeCandidateStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const mergeTargetId = ref('')
const mergePreview = ref<ProductMergePreview>()
const mergeError = ref('')
const mergeCandidateError = ref<RequestError>()
const mergeBusy = ref(false)
const mergeConfirmOpen = ref(false)
const { data, status, error, staleWarning, refreshing, execute, cancel } = useLatestRequest<Awaited<ReturnType<typeof listDictionaryItems>>>(() => {
  selected.value = undefined
  actionsOpen.value = false
  statusConfirmOpen.value = false
  editorOpen.value = false
  mergeOpen.value = false
  mergeConfirmOpen.value = false
})

const items = computed(() => data.value?.items ?? [])
const maxNameLength = computed(() => definition.value?.type === 'product' ? 200 : 100)
const editorTitle = computed(() => editorMode.value === 'create'
  ? `新增${definition.value?.singular ?? '字典项'}`
  : `修改${definition.value?.singular ?? '字典项'}名称`)
const editorDescription = computed(() => definition.value?.hierarchical && editorMode.value === 'create'
  ? '可留空创建一级分类，或选择一级分类创建二级分类。'
  : '名称会用于之后的新记录，历史账目中的名称快照保持不变。')

// 仅对当前代次已接纳的结果同步页码；旧请求或取消不能把新筛选拉回上一页。
watch(data, (page) => {
  if (page && page.page !== pageIndex.value) {
    pageIndex.value = page.page
    scrollPageTo(0)
  }
}, { flush: 'sync' })

async function load(intent: 'replace' | 'refresh' = 'replace'): Promise<void> {
  if (!definition.value) return
  const type = definition.value.type
  const query = appliedQuery.value
  const selectedStatus = statusFilter.value
  const requestedPage = pageIndex.value
  await execute(async (signal) => {
    const readPage = (page: number) => listDictionaryItems(type, query, selectedStatus, signal, page, DICTIONARY_PAGE_SIZE)
    const page = await readPage(requestedPage)
    const lastPage = Math.max(0, Math.ceil(page.total / DICTIONARY_PAGE_SIZE) - 1)
    // 合并、启停和改名可能使当前末页消失；同一请求内至多补读一次，避免假空态闪现。
    return page.page > lastPage ? readPage(lastPage) : page
  }, { intent, isEmpty: (page) => page.items.length === 0 })
}

function turnPage(page: number): void {
  pageIndex.value = page
  // 在当前点按内归零，避免 iOS 在等长结果替换后仍停在新一页末尾。
  scrollPageTo(0)
  void load()
}

function search(value: string): void {
  appliedQuery.value = value.trim()
  pageIndex.value = 0
  void load('replace')
}

async function openCreate(): Promise<void> {
  if (!definition.value) return
  editorMode.value = 'create'
  editorName.value = ''
  editorParentId.value = ''
  editorError.value = ''
  activeRoots.value = []
  parentOptionsStatus.value = definition.value.hierarchical ? 'loading' : 'idle'
  parentOptionsError.value = undefined
  editorOpen.value = true
  if (definition.value.hierarchical) {
    await loadParentOptions()
  }
}

async function loadParentOptions(): Promise<void> {
  if (!definition.value?.hierarchical) return
  parentOptionsStatus.value = 'loading'
  parentOptionsError.value = undefined
  activeRoots.value = []
  try {
    // 预载首批候选，更多一级分类沿用原搜索入口，不把整库读入选择控件。
    const page = await listDictionaryItems(definition.value.type, '', 'ACTIVE', undefined, 0, 100, { rootsOnly: true })
    activeRoots.value = page.items
    parentOptionsStatus.value = 'ready'
  } catch (cause) {
    parentOptionsStatus.value = 'error'
    parentOptionsError.value = normalizeRequestError(cause)
  }
}

async function searchParentRoots(query: string, signal: globalThis.AbortSignal): Promise<DictionaryChoice[]> {
  if (!definition.value) return []
  const page = await listDictionaryItems(definition.value.type, query, 'ACTIVE', signal, 0, 100, { rootsOnly: true })
  return page.items
}
async function createParentRoot(name: string): Promise<DictionaryChoice> {
  const item = await createDictionaryItem('expense-category', name)
  activeRoots.value = [item, ...activeRoots.value]
  return item
}

function canSubmitEditor(): boolean {
  return !(definition.value?.hierarchical && editorMode.value === 'create'
    && parentOptionsStatus.value !== 'ready')
}

async function submitEditor(): Promise<void> {
  if (!definition.value || !canSubmitEditor()) return
  editorError.value = ''
  const name = editorName.value.trim()
  if (!name || [...name].length > maxNameLength.value) {
    editorError.value = `请输入 1-${maxNameLength.value} 个字符。`
    return
  }
  busy.value = true
  try {
    if (editorMode.value === 'create') {
      await createDictionaryItem(definition.value.type, name, editorParentId.value || undefined)
      showToast('已新增')
    } else if (selected.value) {
      selected.value = await renameDictionaryItem(definition.value.type, selected.value.id, name)
      showToast('名称已更新')
    }
    editorOpen.value = false
    await load('refresh')
  } catch (cause) {
    const requestError = normalizeRequestError(cause)
    editorError.value = requestError.fieldErrors.name?.[0] ?? requestError.fieldErrors.parentId?.[0] ?? requestError.message
  } finally {
    busy.value = false
  }
}

function openActions(item: DictionaryListItem): void {
  selected.value = items.value.find((candidate) => candidate.id === item.id)
  actionsOpen.value = true
}

function openRename(): void {
  if (!selected.value) return
  editorMode.value = 'rename'
  editorName.value = selected.value.name
  editorError.value = ''
  editorOpen.value = true
}

async function openMerge(): Promise<void> {
  mergeQuery.value = ''
  mergeTargetId.value = ''
  mergePreview.value = undefined
  mergeError.value = ''
  mergeOpen.value = true
  await loadMergeCandidates('')
}

async function loadMergeCandidates(query: string): Promise<void> {
  if (!selected.value) return
  mergeCandidateStatus.value = 'loading'
  mergeError.value = ''
  mergeCandidateError.value = undefined
  mergeTargetId.value = ''
  mergePreview.value = undefined
  try {
    const page = await listDictionaryCandidates('product', query)
    mergeCandidates.value = page.items.filter((item) => item.id !== selected.value?.id)
    mergeCandidateStatus.value = 'ready'
  } catch (cause) {
    mergeCandidateStatus.value = 'error'
    mergeCandidateError.value = normalizeRequestError(cause)
  }
}

async function loadMergePreview(): Promise<void> {
  if (!selected.value || !mergeTargetId.value) {
    mergeError.value = '请选择要保留的商品。'
    return
  }
  mergeBusy.value = true
  mergeError.value = ''
  try {
    mergePreview.value = await previewProductMerge(selected.value.id, mergeTargetId.value)
  } catch (cause) {
    mergePreview.value = undefined
    mergeError.value = normalizeRequestError(cause).message
  } finally {
    mergeBusy.value = false
  }
}

async function confirmMerge(): Promise<void> {
  if (!selected.value || !mergeTargetId.value || !mergePreview.value) return
  mergeBusy.value = true
  try {
    await mergeProduct(selected.value.id, mergeTargetId.value)
    mergeConfirmOpen.value = false
    mergeOpen.value = false
    actionsOpen.value = false
    selected.value = undefined
    showToast('商品已合并，历史名称快照保持不变')
    await load('refresh')
  } catch (cause) {
    mergeConfirmOpen.value = false
    mergeError.value = normalizeRequestError(cause).message
    showToast(mergeError.value, 'error')
  } finally {
    mergeBusy.value = false
  }
}


async function mutateSelected(): Promise<void> {
  if (!definition.value || !selected.value || busy.value) return
  busy.value = true
  try {
    const next = selected.value.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    selected.value = await changeDictionaryItemStatus(definition.value.type, selected.value.id, next)
    showToast(next === 'ACTIVE' ? '已恢复，可用于新记录' : '已停用，历史引用保持不变')
    statusConfirmOpen.value = false
    actionsOpen.value = false
    await load('refresh')
  } catch (cause) {
    showToast(normalizeRequestError(cause).message, 'error')
  } finally { busy.value = false }
}

async function reorder(move: ReorderMove): Promise<void> {
  if (!definition.value || busy.value) return
  const type = definition.value?.type
  if (!type) return
  busy.value = true
  try {
    await moveDictionaryItem(type, move.id, move.direction, move.targetId)
    if (definition.value?.type !== type) return
    await load('refresh')
    showToast('顺序已更新')
  } catch (cause) {
    if (definition.value?.type !== type) return
    showToast(normalizeRequestError(cause).message, 'error')
    if (definition.value?.type !== type) return
    await load('refresh')
  } finally { busy.value = false }
}

function requestStatusChange(): void {
  if (!selected.value || busy.value) return
  if (selected.value.status === 'ACTIVE') {
    statusConfirmOpen.value = true
  } else void mutateSelected()
}

function showToast(message: string, kind: 'success' | 'error' = 'success'): void {
  toastMessage.value = message
  toastKind.value = kind
  toastOpen.value = true
}

function handleEmptyAction(): void {
  if (appliedQuery.value || statusFilter.value) {
    queryDraft.value = ''
    appliedQuery.value = ''
    statusFilter.value = ''
    pageIndex.value = 0
    void load()
  } else {
    void openCreate()
  }
}

watch(statusFilter, () => {
  pageIndex.value = 0
  void load()
})
watch(() => route.params.type, () => {
  cancel()
  if (!definition.value) {
    void router.replace({ name: 'personal-dictionaries' })
    return
  }
  queryDraft.value = ''
  appliedQuery.value = ''
  statusFilter.value = ''
  pageIndex.value = 0
  selected.value = undefined
  void load()
})

function returnToIndex(): void {
  const target = dictionaryIndexTarget(route.query.from)
  // 从索引进入就退回已有历史项；直接打开详情时使用受控来源，不制造往返循环。
  if (router.options.history.state.back === router.resolve(target).fullPath) router.back()
  else void router.replace(target)
}

onMounted(() => {
  if (!definition.value) void router.replace({ name: 'personal-dictionaries' })
  else void load()
})
useRefreshOnReturn(() => load('refresh'))
</script>

<template>
  <PageWorkspace
    v-if="definition"
    content-label="字典列表"
    class="dictionary-detail-page"
    data-page-key="personal-dictionary-detail"
  >
    <template #header>
      <header class="dictionary-page-heading">
        <button
          type="button"
          class="icon-button"
          aria-label="返回选项管理"
          @click="returnToIndex"
        >
          <ArrowLeft
            :size="20"
            aria-hidden="true"
          />
        </button>
        <div>
          <h1>{{ definition.label }}</h1>
          <p>{{ definition.description }}</p>
        </div>
        <button
          type="button"
          class="primary-button dictionary-add-button"
          @click="openCreate"
        >
          <Plus
            :size="18"
            aria-hidden="true"
          /> 新增
        </button>
      </header>

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
    </template>
    <AppAsyncRegion
      :status="status"
      :error="error"
      :stale-warning="staleWarning"
      :refreshing="refreshing"
      :loading-title="`正在加载${definition.label}`"
      :error-title="`${definition.label}暂不可用`"
      :empty-title="appliedQuery || statusFilter ? '没有匹配项' : `还没有${definition.label}`"
      :empty-message="appliedQuery || statusFilter ? '清除搜索和状态条件后重试。' : `新增第一项${definition.singular}，之后可在记账候选中使用。`"
      :empty-action-label="appliedQuery || statusFilter ? '清除条件' : '新增'"
      @retry="load()"
      @stale-retry="load('refresh')"
      @empty-action="handleEmptyAction"
    >
      <DictionaryItemList
        :items="items"
        :label="definition.label"
        :busy="busy || refreshing"
        history-hint
        @move="reorder"
        @select="openActions"
      />

      <DictionaryListFooter
        v-if="status === 'ready'"
        :page="pageIndex"
        :total="data?.total ?? 0"
        :label="definition.label"
        :busy="refreshing"
        @update:page="turnPage"
      />
    </AppAsyncRegion>

    <template #overlays>
      <AppDrawer
        id="dictionary-actions"
        v-model:open="actionsOpen"
        :busy="busy || mergeBusy"
        :title="selected?.name ?? `${definition.label}操作`"
        :description="selected?.referenced ? '此项已被引用；改名或停用不会改写历史名称快照。' : '管理操作只影响本机账本。'"
      >
        <div
          v-if="selected"
          class="context-action-list"
        >
          <button
            type="button"
            :disabled="busy"
            @click="openRename"
          >
            修改名称
          </button>
          <button
            type="button"
            :disabled="busy"
            @click="requestStatusChange"
          >
            {{ selected.status === 'ACTIVE' ? '停用' : '恢复' }}
          </button>
          <button
            v-if="definition.type === 'product'"
            type="button"
            class="danger-text"
            :disabled="busy"
            @click="openMerge"
          >
            合并到其他商品
          </button>
        </div>
      </AppDrawer>

      <AppDialog
        id="dictionary-status-confirm"
        v-model:open="statusConfirmOpen"
        :title="`停用${selected?.name ?? '此选项'}？`"
        description="停用后不再作为新记录的候选；已有账目、历史名称和引用保持不变，可随时恢复。"
        confirm-label="停用"
        :busy="busy"
        @confirm="mutateSelected"
      />

      <AppDrawer
        id="product-merge"
        v-model:open="mergeOpen"
        :busy="mergeBusy"
        title="合并商品"
        :description="`选择保留商品后，${selected?.name ?? '当前商品'}将不再作为候选；历史账目名称仍保留。`"
      >
        <div class="product-merge-flow">
          <GlobalLedgerSearch
            id="product-merge-search"
            v-model="mergeQuery"
            label="搜索保留商品"
            placeholder="输入商品名称缩小范围"
            @search="loadMergeCandidates"
          />
          <AppStateBlock
            v-if="mergeCandidateStatus === 'loading'"
            kind="loading"
            title="正在读取可合并商品"
          />
          <AppRequestError
            v-else-if="mergeCandidateStatus === 'error'"
            title="可合并商品暂不可用"
            :error="mergeCandidateError"
            @retry="loadMergeCandidates(mergeQuery)"
          />
          <AppStateBlock
            v-else-if="mergeCandidateStatus === 'ready' && mergeCandidates.length === 0"
            kind="empty"
            title="没有可保留的启用商品"
            message="调整搜索词，或先新增另一个商品。"
          />
          <FormField
            v-else-if="mergeCandidateStatus === 'ready'"
            field-id="merge-target"
            label="保留商品"
            help="合并后，账目和日常模板都归入这个商品。"
            :error="mergeError"
          >
            <template #default="{ describedBy }">
              <select
                id="merge-target"
                v-model="mergeTargetId"
                :aria-describedby="describedBy"
                @change="mergePreview = undefined; mergeError = ''"
              >
                <option value="">
                  请选择
                </option>
                <option
                  v-for="candidate in mergeCandidates"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.name }}
                </option>
              </select>
            </template>
          </FormField>
          <button
            v-if="mergeCandidateStatus === 'ready' && mergeCandidates.length > 0"
            type="button"
            class="secondary-button"
            :disabled="mergeBusy || !mergeTargetId"
            @click="loadMergePreview"
          >
            {{ mergeBusy ? '正在计算影响…' : '预览合并影响' }}
          </button>
          <dl
            v-if="mergePreview"
            class="merge-impact"
          >
            <dt>合并方向</dt><dd>{{ mergePreview.source.name }} → {{ mergePreview.target.name }}</dd>
            <dt>账目引用</dt><dd>{{ mergePreview.affectedLedgerEntries }} 条</dd>
            <dt>日常模板</dt><dd>{{ mergePreview.affectedTemplates }} 项</dd>
            <dt>模板冲突</dt><dd>{{ mergePreview.templateConflict ? '保留最近使用内容并收敛为一项' : '无冲突' }}</dd>
          </dl>
          <button
            v-if="mergePreview"
            type="button"
            class="danger-button"
            :disabled="mergeBusy"
            @click="mergeConfirmOpen = true"
          >
            继续合并
          </button>
        </div>
      </AppDrawer>

      <AppDialog
        id="confirm-product-merge"
        v-model:open="mergeConfirmOpen"
        title="确认合并商品？"
        :description="mergePreview ? `${mergePreview.source.name}会合并到${mergePreview.target.name}。此操作不能在页面中撤销。` : ''"
        confirm-label="确认合并"
        danger
        :busy="mergeBusy"
        @confirm="confirmMerge"
      />

      <AppDialog
        id="dictionary-editor"
        v-model:open="editorOpen"
        :title="editorTitle"
        :description="editorDescription"
        :confirm-label="editorMode === 'create' ? '新增' : '保存名称'"
        :busy="busy"
        :confirm-disabled="!canSubmitEditor()"
        @confirm="submitEditor"
      >
        <div class="dictionary-editor-form">
          <AppStateBlock
            v-if="definition.hierarchical && editorMode === 'create' && parentOptionsStatus === 'loading'"
            kind="loading"
            title="正在加载一级分类"
          />
          <AppRequestError
            v-else-if="definition.hierarchical && editorMode === 'create' && parentOptionsStatus === 'error'"
            title="一级分类暂不可用"
            :error="parentOptionsError"
            @retry="loadParentOptions"
          />
          <FormField
            field-id="dictionary-name"
            label="名称"
            :help="`最多 ${maxNameLength} 个字符；等价名称不会重复创建。`"
            :error="editorError"
          >
            <template #default="{ describedBy }">
              <input
                id="dictionary-name"
                v-model="editorName"
                :maxlength="maxNameLength"
                autocomplete="off"
                :aria-describedby="describedBy"
                @keydown.enter.prevent="submitEditor"
              >
            </template>
          </FormField>
          <DictionaryCombobox
            v-if="definition.hierarchical && editorMode === 'create' && parentOptionsStatus === 'ready'"
            input-id="dictionary-parent"
            :clear-on-input="false"
            type="expense-category"
            label="父分类"
            optional
            :items="activeRoots"
            :model-value="editorParentId"
            :load-items="searchParentRoots"
            :create-item="createParentRoot"
            @select="editorParentId = $event.id"
            @clear="editorParentId = ''"
          />
        </div>
      </AppDialog>

      <AppToast
        v-model:open="toastOpen"
        :message="toastMessage"
        :kind="toastKind"
      />
    </template>
  </PageWorkspace>
</template>
