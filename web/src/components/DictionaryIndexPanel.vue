<script setup lang="ts">
import { useRefreshOnReturn } from '../composables/useRefreshOnReturn'
import { computed, onMounted } from 'vue'
import { listDictionarySummaries } from '../api/dictionaries'
import { useLatestRequest } from '../composables/useLatestRequest'
import { dictionaryDefinition, dictionaryDefinitions, type DictionaryType } from '../domain/dictionaries'
import AppAsyncRegion from './AppAsyncRegion.vue'
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
    value: summary ? `${summary.active} 启用 · ${summary.total} 项` : '数量暂不可用',
  }
}))

async function load(intent: 'replace' | 'refresh' = 'replace'): Promise<void> {
  await execute((signal) => listDictionarySummaries(signal), { intent: intent === 'refresh' ? 'silent' : 'replace' })
}

onMounted(() => void load())
useRefreshOnReturn(() => load('refresh'))
</script>

<template>
  <AppAsyncRegion
    :status="status"
    :error="error"
    :stale-warning="staleWarning"
    loading-title="正在读取选项"
    error-title="选项暂不可用"
    @retry="load()"
    @stale-retry="load('refresh')"
  >
    <SettingsDisclosureList
      label="选项类型"
      :items="items"
      @select="select"
    />
  </AppAsyncRegion>
</template>
