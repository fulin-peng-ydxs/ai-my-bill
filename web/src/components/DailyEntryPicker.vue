<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  listDailyTemplates, removeDailyTemplate, selectDailyTemplate,
  type DailyTemplateEntryType, type DailyTemplateSelection, type DailyTemplateSummary,
} from '../api/dailyTemplates'
import AppDrawer from './AppDrawer.vue'
import AppStateBlock from './AppStateBlock.vue'
import EntryTypeSwitch from './EntryTypeSwitch.vue'

const props = defineProps<{ entryType: DailyTemplateEntryType }>()
const emit = defineEmits<{ select: [selection: DailyTemplateSelection] }>()

const open = ref(false)
const activeType = ref<DailyTemplateEntryType>(props.entryType)
const items = ref<DailyTemplateSummary[]>([])
const loading = ref(false)
const error = ref('')
const busyId = ref('')
let loadRevision = 0
const title = computed(() => activeType.value === 'EXPENSE' ? '日常支出' : '日常收入')

watch(() => props.entryType, (value) => {
  if (!open.value) activeType.value = value
})

watch(open, (value) => {
  if (!value) return
  const typeChanged = activeType.value !== props.entryType
  activeType.value = props.entryType
  if (!typeChanged) void load()
})

watch(activeType, () => {
  if (open.value) void load()
})

async function load(): Promise<void> {
  const revision = ++loadRevision
  const requestedType = activeType.value
  loading.value = true
  error.value = ''
  try {
    const response = await listDailyTemplates(requestedType)
    if (revision !== loadRevision) return
    items.value = response.items
  } catch (cause) {
    if (revision !== loadRevision) return
    error.value = cause instanceof Error ? cause.message : '日常模板加载失败，请重试。'
  } finally {
    if (revision === loadRevision) loading.value = false
  }
}

async function choose(item: DailyTemplateSummary): Promise<void> {
  if (busyId.value) return
  busyId.value = item.id
  error.value = ''
  try {
    const selection = await selectDailyTemplate(item.id)
    emit('select', selection)
    open.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '模板应用失败，请重试。'
  } finally {
    busyId.value = ''
  }
}

async function remove(item: DailyTemplateSummary): Promise<void> {
  if (busyId.value) return
  busyId.value = item.id
  error.value = ''
  try {
    await removeDailyTemplate(item.id)
    items.value = items.value.filter((candidate) => candidate.id !== item.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '模板移除失败，请重试。'
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
    :title="title"
    description="只回填可复用字段，不会自动保存，也不会覆盖本次时间和备注。"
  >
    <div class="daily-entry-picker">
      <EntryTypeSwitch
        v-model="activeType"
        label="日常模板类型"
        :disabled="Boolean(busyId)"
      />
      <AppStateBlock
        v-if="loading"
        kind="loading"
        title="正在加载日常模板"
      />
      <AppStateBlock
        v-else-if="error"
        kind="error"
        title="暂时无法完成操作"
        :message="error"
        action-label="重新加载"
        @action="load"
      />
      <AppStateBlock
        v-else-if="!items.length"
        kind="empty"
        title="还没有日常模板"
        message="到明细中左滑或长按一笔有效账目，选择“加入日常”。"
      />
      <ul
        v-else
        class="daily-template-list"
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
            <span>{{ item.contextName }} · {{ item.entryType === 'EXPENSE' ? '−' : '+' }}¥{{ item.amount }}</span>
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
        class="daily-template-note"
      >
        移除只影响日常模板，不会删除原账目。
      </p>
    </div>
  </AppDrawer>
</template>
