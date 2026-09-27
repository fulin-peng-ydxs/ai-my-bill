<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { getDictionaryItem, listDictionaryItems, type DictionaryItem, type DictionaryPage } from '../api/dictionaries'
import { useLatestRequest } from '../composables/useLatestRequest'
import type { DictionaryType } from '../domain/dictionaries'
import AppStateBlock from './AppStateBlock.vue'
import FormField from './FormField.vue'
import GlobalLedgerSearch from './GlobalLedgerSearch.vue'

const props = defineProps<{
  id: string
  label: string
  type: DictionaryType
  modelValue?: string
  parentId?: string
  rootsOnly?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()
const query = ref('')
const page = ref(0)
const request = useLatestRequest<DictionaryPage>()
const selected = useLatestRequest<DictionaryItem>()
const items = computed(() => {
  const current = request.data.value?.items ?? []
  const chosen = selected.data.value
  return chosen && chosen.id === props.modelValue && !current.some((item) => item.id === chosen.id) ? [chosen, ...current] : current
})
const pageCount = computed(() => Math.max(1, Math.ceil((request.data.value?.total ?? 0) / 20)))

function load(): void {
  if (props.disabled) { request.cancel(); return }
  void request.execute((signal) => listDictionaryItems(props.type, query.value, '', signal, page.value, 20,
    { parentId: props.parentId, rootsOnly: props.rootsOnly }))
}
function search(value: string): void { query.value = value; page.value = 0; load() }
function turnPage(next: number): void { page.value = next; load() }
watch(() => [props.type, props.parentId, props.rootsOnly, props.disabled], () => {
  query.value = ''; page.value = 0; load()
}, { immediate: true })
watch(() => [props.type, props.modelValue], () => {
  if (props.modelValue) void selected.execute((signal) => getDictionaryItem(props.type, props.modelValue!, signal))
  else selected.cancel()
}, { immediate: true })
</script>

<template>
  <div class="dictionary-filter-picker">
    <FormField
      :field-id="id"
      :label="label"
      help="可搜索或翻页；停用项仍可用于查询历史账目。"
    >
      <select
        :id="id"
        :value="modelValue ?? ''"
        :disabled="disabled"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value || undefined)"
      >
        <option value="">
          全部{{ label }}（不限）
        </option>
        <option
          v-if="modelValue && !items.some(item => item.id === modelValue)"
          :value="modelValue"
        >
          已选{{ label }}（名称待加载）
        </option>
        <option
          v-for="item in items"
          :key="item.id"
          :value="item.id"
        >
          {{ item.name }}{{ item.status === 'INACTIVE' ? '（已停用）' : '' }}
        </option>
      </select>
    </FormField>
    <template v-if="!disabled">
      <GlobalLedgerSearch
        :id="`${id}-search`"
        v-model="query"
        :label="`搜索${label}`"
        :placeholder="`搜索${label}`"
        :max-length="64"
        @search="search"
      />
      <AppStateBlock
        v-if="request.status.value === 'loading'"
        kind="loading"
        :title="`正在加载${label}`"
      />
      <AppStateBlock
        v-else-if="request.error.value"
        :kind="request.error.value.kind === 'forbidden' ? 'permission' : 'error'"
        :title="`${label}加载失败`"
        :message="request.error.value.message"
        :action-label="request.error.value.kind === 'forbidden' ? undefined : '重试'"
        @action="load"
      />
      <p
        v-else-if="request.data.value?.total === 0"
        class="caption"
      >
        没有匹配选项，可清空搜索重试。
      </p>
      <div
        v-if="pageCount > 1"
        class="dictionary-filter-pagination"
        :aria-label="`${label}分页`"
      >
        <button
          type="button"
          class="secondary-button"
          :disabled="page === 0 || request.status.value === 'loading'"
          @click="turnPage(page - 1)"
        >
          上一页
        </button>
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <button
          type="button"
          class="secondary-button"
          :disabled="page + 1 >= pageCount || request.status.value === 'loading'"
          @click="turnPage(page + 1)"
        >
          下一页
        </button>
      </div>
      <p
        v-if="selected.error.value"
        class="field-error"
        role="alert"
      >
        已选项名称暂不可用，筛选值已保留。
      </p>
    </template>
  </div>
</template>
