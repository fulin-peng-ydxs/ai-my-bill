<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import { DICTIONARY_PAGE_SIZE } from '../domain/dictionaries'

import GlobalLedgerSearch from './GlobalLedgerSearch.vue'
import AppLoadingHint from './AppLoadingHint.vue'
import SegmentedControl from './SegmentedControl.vue'

type Status = 'ACTIVE' | 'INACTIVE' | ''

defineProps<{
  label: string
  total?: number
  refreshing: boolean
  page?: number
  shown?: number
}>()

const query = defineModel<string>('query', { required: true })
const status = defineModel<Status>('status', { required: true })
const emit = defineEmits<{
  search: [value: string]
  refresh: []
}>()

const statusOptions = [
  { value: '', label: '全部' },
  { value: 'ACTIVE', label: '启用' },
  { value: 'INACTIVE', label: '停用' },
] as const
</script>

<template>
  <div class="dictionary-toolbar">
    <GlobalLedgerSearch
      :id="`dictionary-search-${label}`"
      v-model="query"
      :label="`搜索${label}`"
      :placeholder="`搜索${label}名称`"
      @search="emit('search', $event)"
    />
    <SegmentedControl
      v-model="status"
      :options="statusOptions"
      label="字典项状态"
    />
    <button
      type="button"
      class="icon-button"
      :disabled="refreshing"
      :aria-label="`刷新${label}`"
      @click="emit('refresh')"
    >
      <RefreshCw
        :size="18"
        aria-hidden="true"
      />
    </button>
    <span class="dictionary-result-count">
      <AppLoadingHint :pending="refreshing" />
      <template v-if="total !== undefined">
        <template v-if="shown && total > shown">
          第 {{ (page ?? 0) * DICTIONARY_PAGE_SIZE + 1 }}–{{ (page ?? 0) * DICTIONARY_PAGE_SIZE + shown }} 项 /
        </template>共 {{ total }} 项
      </template>
    </span>
  </div>
</template>
