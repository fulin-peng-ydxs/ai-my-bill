<script setup lang="ts">
import MoneyValue from './MoneyValue.vue'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useBootstrapStore } from '../stores/bootstrap'

import {
  listDailyTemplates, removeDailyTemplate, selectDailyTemplate,
  type DailyTemplateEntryType, type DailyTemplateSelection, type DailyTemplateSummary,
} from '../api/dailyTemplates'
import AppDrawer from './AppDrawer.vue'
import AppAsyncRegion from './AppAsyncRegion.vue'
import AppStatusNotice from './AppStatusNotice.vue'
import { isAccessDenied, normalizeRequestError, type RequestError } from '../api/errors'
import { useLatestRequest } from '../composables/useLatestRequest'
import EntryTypeSwitch from './EntryTypeSwitch.vue'

const props = defineProps<{ entryType: DailyTemplateEntryType }>()
const emit = defineEmits<{ select: [selection: DailyTemplateSelection] }>()

const open = ref(false)
const activeType = ref<DailyTemplateEntryType>(props.entryType)
const request = useLatestRequest<Awaited<ReturnType<typeof listDailyTemplates>>>()
const items = computed(() => request.data.value?.items ?? [])
const actionError = ref<RequestError>()
const regionStatus = computed(() => isAccessDenied(actionError.value) ? 'error' : request.status.value)
const busyId = ref('')
const bootstrap = useBootstrapStore()
let generation = 0
onScopeDispose(() => { generation += 1 })
watch(() => bootstrap.datasetId, () => { generation += 1; open.value = false; request.cancel() })
const title = computed(() => activeType.value === 'EXPENSE' ? '日常支出' : '日常收入')

watch(() => props.entryType, (value) => {
  if (!open.value) activeType.value = value
})

watch(open, (value) => {
  if (!value) { request.cancel(); return }
  const typeChanged = activeType.value !== props.entryType
  activeType.value = props.entryType
  if (!typeChanged) void load()
})

watch(activeType, () => {
  if (open.value) void load()
})

async function load(): Promise<void> {
  actionError.value = undefined
  await request.execute((signal) => listDailyTemplates(activeType.value, signal), { isEmpty: (page) => page.items.length === 0 })
}

async function choose(item: DailyTemplateSummary): Promise<void> {
  if (busyId.value) return
  busyId.value = item.id
  actionError.value = undefined
  const requestedGeneration = generation
  try {
    const selection = await selectDailyTemplate(item.id)
    if (requestedGeneration !== generation || !open.value) return
    emit('select', selection)
    open.value = false
  } catch (cause) {
    actionError.value = normalizeRequestError(cause)
  } finally {
    busyId.value = ''
  }
}

async function remove(item: DailyTemplateSummary): Promise<void> {
  if (busyId.value) return
  busyId.value = item.id
  actionError.value = undefined
  try {
    await removeDailyTemplate(item.id)
    if (request.data.value) request.data.value = { ...request.data.value, items: items.value.filter((candidate) => candidate.id !== item.id) }
    if (!items.value.length) request.status.value = 'empty'
  } catch (cause) {
    actionError.value = normalizeRequestError(cause)
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <button
    type="button"
    class="compact-action"
    @click="open = true"
  >
    {{ entryType === 'EXPENSE' ? '日常支出' : '日常收入' }}
  </button>

  <AppDrawer
    id="daily-entry-picker"
    v-model:open="open"
    :busy="Boolean(busyId)"
    :title="title"
    description="回填可复用字段，时间更新为当前时间，备注清空；请核对后保存。"
  >
    <div class="daily-entry-picker">
      <EntryTypeSwitch
        v-model="activeType"
        label="日常模板类型"
        :disabled="Boolean(busyId)"
      />
      <AppStatusNotice
        v-if="actionError && !isAccessDenied(actionError)"
        title="操作未完成"
        :error="actionError"
      />
      <AppAsyncRegion
        :status="regionStatus"
        :error="isAccessDenied(actionError) ? actionError : request.error.value"
        loading-title="正在加载日常模板"
        error-title="日常模板暂不可用"
        empty-title="还没有日常模板"
        :empty-message="`到明细中打开一笔有效账目的更多操作，选择“保存为日常${activeType === 'EXPENSE' ? '支出' : '收入'}”。`"
        @retry="load"
      >
        <ul
          class="daily-template-list content-list"
        >
          <li
            v-for="item in items"
            :key="item.id"
          >
            <button
              type="button"
              class="daily-template-choice"
              :disabled="Boolean(busyId)"
              @click="choose(item)"
            >
              <strong>{{ item.displayName }}</strong>
              <span>{{ item.contextName }} · <MoneyValue
                :amount="item.amount"
                :tone="item.entryType === 'EXPENSE' ? 'expense' : 'income'"
                :sign="item.entryType === 'EXPENSE' ? '−' : '+'"
              /></span>
            </button>
            <button
              type="button"
              class="text-action daily-template-remove"
              :disabled="Boolean(busyId)"
              :aria-label="`移除日常模板：${item.displayName}`"
              @click="remove(item)"
            >
              {{ busyId === item.id ? '处理中…' : '移除' }}
            </button>
          </li>
        </ul>
        <p
          v-if="items.length"
          class="daily-template-note list-end-note"
        >
          本批 {{ items.length }} 项 · 移除不会删除原账目。
        </p>
      </AppAsyncRegion>
    </div>
  </AppDrawer>
</template>
