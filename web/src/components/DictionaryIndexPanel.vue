<script setup lang="ts">
import { useRefreshOnReturn } from '../composables/useRefreshOnReturn'
import { computed, onMounted } from 'vue'
import { listDictionarySummaries } from '../api/dictionaries'
import { useLatestRequest } from '../composables/useLatestRequest'
import { dictionaryDefinition, dictionaryDefinitions, type DictionaryType } from '../domain/dictionaries'
import AppStateBlock from './AppStateBlock.vue'
import SettingsDisclosureList, { type SettingsDisclosureItem } from './SettingsDisclosureList.vue'

const emit = defineEmits<{ select: [type: DictionaryType] }>()
function select(type: string): void {
  const definition = dictionaryDefinition(type)
  if (definition) emit('select', definition.type)
}
const { data, status, error, staleWarning, execute } = useLatestRequest<Awaited<ReturnType<typeof listDictionarySummaries>>>()

const items = computed<SettingsDisclosureItem[]>(() => dictionaryDefinitions.map((definition) => {
  const summary = data.value?.items.find((item) => item.type === definition.type)
  return {
    key: definition.type,
    label: definition.label,
    value: summary ? `${summary.active} 启用 · ${summary.total} 项` : '0 项',
  }
}))

async function load(intent: 'replace' | 'refresh' = 'replace'): Promise<void> {
  await execute((signal) => listDictionarySummaries(signal), { intent })
}

onMounted(() => void load())
useRefreshOnReturn(() => load('refresh'))
</script>

<template>
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
    title="正在读取个人字典"
  />
  <AppStateBlock
    v-else-if="status === 'error'"
    :kind="error?.kind === 'forbidden' ? 'permission' : 'error'"
    title="个人字典暂不可用"
    :message="error?.message"
    action-label="重试"
    @action="load()"
  />
  <SettingsDisclosureList
    v-else-if="status === 'ready'"
    label="个人字典类型"
    :items="items"
    @select="select"
  />
</template>
