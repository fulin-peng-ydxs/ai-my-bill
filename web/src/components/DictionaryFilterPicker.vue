<script setup lang="ts">
import { canRetryRequest } from '../api/errors'
import { computed, ref, watch } from 'vue'

import { getDictionaryItem, listDictionaryItems, type DictionaryItem, type DictionaryPage } from '../api/dictionaries'
import { useDebouncedQuery } from '../composables/useDebouncedQuery'
import { useLatestRequest } from '../composables/useLatestRequest'
import type { DictionaryType } from '../domain/dictionaries'
import ComboboxField from './ComboboxField.vue'
import AppPagination from './AppPagination.vue'

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
const open = ref(false)
const searching = ref(false)
const request = useLatestRequest<DictionaryPage>()
const selected = useLatestRequest<DictionaryItem>()
const chosen = computed(() => selected.data.value?.id === props.modelValue ? selected.data.value : undefined)
const displayValue = computed(() => chosen.value?.name ?? (props.modelValue ? '已选项名称待加载' : '不限'))
const items = computed(() => request.data.value?.items ?? [])
const pageCount = computed(() => Math.max(1, Math.ceil((request.data.value?.total ?? 0) / 20)))

function load(): void {
  if (props.disabled || !open.value) { request.cancel(); return }
  void request.execute((signal) => listDictionaryItems(props.type, query.value.trim(), '', signal, page.value, 20,
    { parentId: props.parentId, rootsOnly: props.rootsOnly }))
}
const debounced = useDebouncedQuery(() => { page.value = 0; load() })
function start(search: boolean): void {
  if (!open.value) { query.value = ''; page.value = 0 }
  searching.value = search
  open.value = true
  load()
}
function change(value: string): void { query.value = value; debounced.schedule(value) }
function turnPage(next: number): void { page.value = next; load() }
function close(): void { open.value = false; searching.value = false; debounced.cancel(); request.cancel() }
function select(item?: DictionaryItem): void {
  // 搜索与分页只是候选浏览；明确点选后才更改筛选草稿，取消保留原 ID。
  close()
  query.value = ''
  emit('update:modelValue', item?.id)
}
watch(() => [props.type, props.parentId, props.rootsOnly, props.disabled], () => {
  close(); query.value = ''; page.value = 0
})
watch(() => [props.type, props.modelValue], () => {
  if (props.modelValue) void selected.execute((signal) => getDictionaryItem(props.type, props.modelValue!, signal))
  else selected.cancel()
}, { immediate: true })
</script>

<template>
  <div class="entry-combobox dictionary-filter-picker">
    <ComboboxField
      :id="id"
      :label="label"
      :value="open && searching ? query : displayValue"
      :display-value="displayValue"
      :disabled="disabled"
      :placeholder="`搜索${label}`"
      search-label="搜索选项"
      :max-length="64"
      :open="open"
      @open="start"
      @input="change"
      @submit="debounced.submit(query)"
      @close="close"
    >
      <ul
        class="product-options"
        role="listbox"
        :aria-label="label"
      >
        <li>
          <button
            type="button"
            role="option"
            :aria-selected="!modelValue"
            @click="select()"
          >
            <strong>不限{{ label }}</strong>
          </button>
        </li>
        <template v-if="request.status.value !== 'loading' && !request.error.value">
          <li
            v-for="item in items"
            :key="item.id"
          >
            <button
              type="button"
              role="option"
              :aria-selected="modelValue === item.id"
              @click="select(item)"
            >
              <strong>{{ item.name }}</strong><span v-if="item.status === 'INACTIVE'">已停用</span>
            </button>
          </li>
        </template>
      </ul>
      <small
        v-if="request.status.value === 'loading'"
        class="dropdown-status"
      >正在查询…</small>
      <small
        v-else-if="request.error.value"
        class="dropdown-status field-error"
        role="alert"
      >
        {{ request.error.value.message }}
        <button
          v-if="canRetryRequest(request.error.value)"
          type="button"
          class="compact-action"
          @click="load"
        >重试</button>
      </small>
      <p
        v-else-if="request.data.value?.total === 0"
        class="dropdown-status"
      >
        没有匹配选项
      </p>
      <AppPagination
        v-if="!request.error.value"
        :page="page"
        :total-pages="pageCount"
        :label="`${label}分页`"
        :busy="request.status.value === 'loading'"
        @update:page="turnPage"
      />
    </ComboboxField>
    <small
      v-if="disabled"
      class="caption"
    >先选择一级分类</small>
    <small
      v-if="selected.error.value && modelValue"
      class="field-error"
      role="alert"
    >已选项名称暂不可用，筛选值已保留。</small>
  </div>
</template>
