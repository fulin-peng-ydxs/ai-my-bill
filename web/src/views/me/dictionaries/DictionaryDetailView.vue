<script setup lang="ts">
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Plus } from 'lucide-vue-next'
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
import { normalizeRequestError } from '../../../api/errors'
import AppDialog from '../../../components/AppDialog.vue'
import AppDrawer from '../../../components/AppDrawer.vue'
import AppStateBlock from '../../../components/AppStateBlock.vue'
import AppToast from '../../../components/AppToast.vue'
import DictionaryItemList, { type DictionaryListItem } from '../../../components/DictionaryItemList.vue'
import DictionaryToolbar from '../../../components/DictionaryToolbar.vue'
import FormField from '../../../components/FormField.vue'
import GlobalLedgerSearch from '../../../components/GlobalLedgerSearch.vue'
import { useLatestRequest } from '../../../composables/useLatestRequest'
import { dictionaryDefinition } from '../../../domain/dictionaries'

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
const editorOpen = ref(false)
const editorMode = ref<EditorMode>('create')
const editorName = ref('')
const editorParentId = ref('')
const activeRoots = ref<DictionaryItem[]>([])
const parentOptionsStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const parentOptionsError = ref('')
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
const mergeBusy = ref(false)
const mergeConfirmOpen = ref(false)
const { data, status, error, staleWarning, refreshing, execute, cancel } = useLatestRequest<Awaited<ReturnType<typeof listDictionaryItems>>>()

const items = computed(() => data.value?.items ?? [])
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 100)))
const maxNameLength = computed(() => definition.value?.type === 'product' ? 200 : 100)
const editorTitle = computed(() => editorMode.value === 'create'
  ? `新增${definition.value?.singular ?? '字典项'}`
  : `修改${definition.value?.singular ?? '字典项'}名称`)
const editorDescription = computed(() => definition.value?.hierarchical && editorMode.value === 'create'
  ? '可留空创建一级分类，或选择一级分类创建二级分类。'
  : '名称会用于之后的新记录，历史账目中的名称快照保持不变。')

async function load(intent: 'replace' | 'refresh' = 'replace'): Promise<void> {
  if (!definition.value) return
  await execute(
    (signal) => listDictionaryItems(
      definition.value!.type, appliedQuery.value, statusFilter.value, signal, pageIndex.value, 100,
    ),
    { intent, isEmpty: (page) => page.items.length === 0 },
  )
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
  parentOptionsError.value = ''
  editorOpen.value = true
  if (definition.value.hierarchical) {
    await loadParentOptions()
  }
}

async function loadParentOptions(): Promise<void> {
  if (!definition.value?.hierarchical) return
  parentOptionsStatus.value = 'loading'
  parentOptionsError.value = ''
  activeRoots.value = []
  try {
    let rootPage = 0
    let rootTotal = 0
    do {
      const page = await listDictionaryItems(definition.value.type, '', 'ACTIVE', undefined, rootPage, 100)
      activeRoots.value.push(...page.items.filter((item) => !item.parentId))
      rootTotal = page.total
      rootPage += 1
    } while (rootPage * 100 < rootTotal)
    parentOptionsStatus.value = 'ready'
  } catch (cause) {
    parentOptionsStatus.value = 'error'
    parentOptionsError.value = normalizeRequestError(cause).message
  }
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
  actionsOpen.value = false
  editorMode.value = 'rename'
  editorName.value = selected.value.name
  editorError.value = ''
  editorOpen.value = true
}

async function openMerge(): Promise<void> {
  actionsOpen.value = false
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
  mergeTargetId.value = ''
  mergePreview.value = undefined
  try {
    const page = await listDictionaryCandidates('product', query)
    mergeCandidates.value = page.items.filter((item) => item.id !== selected.value?.id)
    mergeCandidateStatus.value = 'ready'
  } catch (cause) {
    mergeCandidateStatus.value = 'error'
    mergeError.value = normalizeRequestError(cause).message
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


async function mutateSelected(action: 'status' | 'UP' | 'DOWN'): Promise<void> {
  if (!definition.value || !selected.value) return
  busy.value = true
  try {
    if (action === 'status') {
      const next = selected.value.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
      selected.value = await changeDictionaryItemStatus(definition.value.type, selected.value.id, next)
      showToast(next === 'ACTIVE' ? '已恢复，可用于新记录' : '已停用，历史引用保持不变')
    } else {
      selected.value = await moveDictionaryItem(definition.value.type, selected.value.id, action)
      showToast(action === 'UP' ? '已上移' : '已下移')
    }
    actionsOpen.value = false
    await load('refresh')
  } catch (cause) {
    const requestError = normalizeRequestError(cause)
    showToast(requestError.message, 'error')
  } finally {
    busy.value = false
  }
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

onMounted(() => {
  if (!definition.value) void router.replace({ name: 'personal-dictionaries' })
  else void load()
})
</script>

<template>
  <article
    v-if="definition"
    class="dictionary-detail-page"
    data-page-key="personal-dictionary-detail"
  >
    <header class="dictionary-page-heading">
      <button
        type="button"
        class="icon-button"
        aria-label="返回个人字典"
        @click="router.push(route.query.from === 'profile' ? { path: '/me', query: { panel: 'dictionaries' } } : { name: 'personal-dictionaries' })"
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
      :total="data?.total ?? 0"
      :refreshing="refreshing"
      @search="search"
      @refresh="load('refresh')"
    />

    <AppStateBlock
      v-if="staleWarning"
      kind="error"
      title="刷新未完成"
      :message="staleWarning.message"
      action-label="重试"
      @action="load('refresh')"
    />
    <AppStateBlock
      v-if="status === 'loading'"
      kind="loading"
      :title="`正在加载${definition.label}`"
    />
    <AppStateBlock
      v-else-if="status === 'error'"
      :kind="error?.kind === 'forbidden' ? 'permission' : 'error'"
      :title="`${definition.label}暂不可用`"
      :message="error?.message"
      action-label="重试"
      @action="load()"
    />
    <AppStateBlock
      v-else-if="status === 'empty'"
      kind="empty"
      :title="appliedQuery || statusFilter ? '没有匹配项' : `还没有${definition.label}`"
      :message="appliedQuery || statusFilter ? '清除搜索和状态条件后重试。' : `新增第一项${definition.singular}，之后可在记账候选中使用。`"
      :action-label="appliedQuery || statusFilter ? '清除条件' : '新增'"
      @action="handleEmptyAction"
    />

    <DictionaryItemList
      v-else-if="status === 'ready'"
      :items="items"
      :label="definition.label"
      history-hint
      @select="openActions"
    />

    <nav
      v-if="status === 'ready' && totalPages > 1"
      class="dictionary-pagination"
      aria-label="字典分页"
    >
      <button
        type="button"
        class="secondary-button"
        :disabled="pageIndex === 0"
        @click="pageIndex -= 1; load()"
      >
        <ChevronLeft
          :size="18"
          aria-hidden="true"
        />上一页
      </button>
      <span>第 {{ pageIndex + 1 }} / {{ totalPages }} 页</span>
      <button
        type="button"
        class="secondary-button"
        :disabled="pageIndex + 1 >= totalPages"
        @click="pageIndex += 1; load()"
      >
        下一页<ChevronRight
          :size="18"
          aria-hidden="true"
        />
      </button>
    </nav>

    <AppDrawer
      id="dictionary-actions"
      v-model:open="actionsOpen"
      :title="selected?.name ?? `${definition.label}操作`"
      :description="selected?.referenced ? '此项已被引用；改名或停用不会改写历史名称快照。' : '管理操作只影响当前账号。'"
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
          @click="mutateSelected('UP')"
        >
          <ArrowUp
            :size="18"
            aria-hidden="true"
          />上移
        </button>
        <button
          type="button"
          :disabled="busy"
          @click="mutateSelected('DOWN')"
        >
          <ArrowDown
            :size="18"
            aria-hidden="true"
          />下移
        </button>
        <button
          type="button"
          :disabled="busy"
          @click="mutateSelected('status')"
        >
          {{ selected.status === 'ACTIVE' ? '停用（保留历史引用）' : '恢复为候选项' }}
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

    <AppDrawer
      id="product-merge"
      v-model:open="mergeOpen"
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
        <AppStateBlock
          v-else-if="mergeCandidateStatus === 'error'"
          kind="error"
          title="可合并商品暂不可用"
          :message="mergeError"
          action-label="重试"
          @action="loadMergeCandidates(mergeQuery)"
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
        <AppStateBlock
          v-else-if="definition.hierarchical && editorMode === 'create' && parentOptionsStatus === 'error'"
          kind="error"
          title="一级分类暂不可用"
          :message="parentOptionsError"
          action-label="重试"
          @action="loadParentOptions"
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
        <FormField
          v-if="definition.hierarchical && editorMode === 'create' && parentOptionsStatus === 'ready'"
          field-id="dictionary-parent"
          label="父分类"
          help="不选择时创建一级分类；只能选择启用中的一级分类。"
        >
          <template #default="{ describedBy }">
            <select
              id="dictionary-parent"
              v-model="editorParentId"
              :aria-describedby="describedBy"
            >
              <option value="">
                无（一级分类）
              </option>
              <option
                v-for="root in activeRoots"
                :key="root.id"
                :value="root.id"
              >
                {{ root.name }}
              </option>
            </select>
          </template>
        </FormField>
      </div>
    </AppDialog>

    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
    />
  </article>
</template>
