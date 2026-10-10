<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'

import ComboboxField from './ComboboxField.vue'

import { createDictionaryItem, getDictionaryItem, listDictionaryCandidates, listDictionaryItems } from '../api/dictionaries'
import { normalizeRequestError } from '../api/errors'
import { useDebouncedQuery } from '../composables/useDebouncedQuery'
import { useLatestRequest } from '../composables/useLatestRequest'
import { normalizeDictionaryName, type DictionaryType } from '../domain/dictionaries'

export interface DictionaryChoice { id: string, name: string, parentId?: string }

const props = defineProps<{
  type: DictionaryType
  label: string
  labelIcon?: Component
  items: DictionaryChoice[]
  modelValue?: string
  parentId?: string
  optional?: boolean
  clearOnInput?: boolean
  disabled?: boolean
  error?: string
  inputId: string
  loadItems?: (query: string, signal: globalThis.AbortSignal) => Promise<DictionaryChoice[]>
  createItem?: (name: string) => Promise<DictionaryChoice>
}>()
const emit = defineEmits<{ select: [item: DictionaryChoice], resolved: [item: DictionaryChoice], clear: [] }>()

const query = ref('')
const browsing = ref(false)
const open = ref(false)
const typing = ref(false)
const creating = ref(false)
let interactionVersion = 0
const createError = ref('')
const searchedQuery = ref<string>()
const resolvedItem = ref<DictionaryChoice>()
const selectedItem = computed(() => props.items.find((item) => item.id === props.modelValue)
  ?? (resolvedItem.value?.id === props.modelValue ? resolvedItem.value : undefined))
// 摘要消费同一份按 ID 回显的名称；通知元信息不代表用户重新选择或修改草稿。
watch(selectedItem, (item) => { if (item) emit('resolved', item) }, { immediate: true })
const request = useLatestRequest<DictionaryChoice[]>()
const searchTerm = computed(() => browsing.value ? '' : query.value)
const normalizedQuery = computed(() => normalizeDictionaryName(searchTerm.value))
const candidates = computed(() => {
  const source = searchedQuery.value === searchTerm.value && request.data.value ? request.data.value : props.items
  const choices = resolvedItem.value && !source.some((item) => item.id === resolvedItem.value?.id)
    ? [...source, resolvedItem.value] : source
  return choices.filter((item) => normalizeDictionaryName(item.name).includes(normalizedQuery.value))
})
const exactMatch = computed(() => [...candidates.value, ...props.items]
  .some((item) => normalizeDictionaryName(item.name) === normalizedQuery.value))
const nameTooLong = computed(() => [...query.value.trim()].length > 100)
const canCreate = computed(() => !browsing.value && normalizedQuery.value.length > 0 && !nameTooLong.value && !exactMatch.value)

watch([() => props.modelValue, () => props.items], ([modelValue], previous, onCleanup) => {
  // 候选刷新不能覆盖正在编辑的搜索词；明确的已选 ID 变化仍正常同步回显。
  if (typing.value && modelValue === previous?.[0]) return
  if (props.modelValue) {
    const selected = props.items.find((item) => item.id === props.modelValue)
    if (selected) {
      resolvedItem.value = undefined
      query.value = selected.name
      typing.value = false
    } else if (resolvedItem.value?.id === props.modelValue) {
      query.value = resolvedItem.value.name
      typing.value = false
    } else {
      resolvedItem.value = undefined
      query.value = ''
      const controller = new globalThis.AbortController()
      onCleanup(() => controller.abort())
      if (!props.loadItems) void getDictionaryItem(props.type, props.modelValue, controller.signal).then((item) => {
        if (controller.signal.aborted) return
        resolvedItem.value = { id: item.id, name: item.name, parentId: item.parentId }
        query.value = item.name
        typing.value = false
      }).catch(() => undefined)
    }
  } else {
    resolvedItem.value = undefined
    if (!typing.value) query.value = ''
  }
}, { immediate: true })
watch(() => props.parentId, () => {
  debounced.cancel()
  request.cancel()
  searchedQuery.value = undefined
  open.value = false
  typing.value = false
  query.value = props.items.find((item) => item.id === props.modelValue)?.name ?? ''
})

async function search(value: string): Promise<void> {
  searchedQuery.value = value
  await request.execute((signal) => props.loadItems ? props.loadItems(value.trim(), signal) : props.type === 'expense-category'
    ? listDictionaryItems(props.type, value.trim(), 'ACTIVE', signal, 0, 100,
      props.parentId ? { parentId: props.parentId } : { rootsOnly: true }).then((page) => page.items)
    : listDictionaryCandidates(props.type, value.trim(), signal).then((page) => page.items), {
    isEmpty: (items) => items.length === 0,
  })
}
const debounced = useDebouncedQuery((value: string) => { void search(value) })

function focus(searching: boolean): void {
  if (!open.value) interactionVersion++
  browsing.value = !searching
  open.value = true
  if ((searchTerm.value || !props.items.length) && (searchedQuery.value !== searchTerm.value || !request.data.value)) {
    void search(searchTerm.value)
  }
}

function change(value: string): void {
  browsing.value = false
  query.value = value
  typing.value = true
  open.value = true
  createError.value = ''
  // 搜索只是挑选过程，取消仍保留原值；明确请求即时清除的旧消费者才提前清除。
  if (props.modelValue && props.clearOnInput === true) emit('clear')
  debounced.schedule(value)
}

function close(): void {
  open.value = false
  debounced.cancel()
  request.cancel()
  const selected = props.items.find((item) => item.id === props.modelValue)
    ?? (resolvedItem.value?.id === props.modelValue ? resolvedItem.value : undefined)
  query.value = selected?.name ?? ''
  typing.value = false
  createError.value = ''
}

function select(item: DictionaryChoice): void {
  debounced.cancel()
  request.cancel()
  searchedQuery.value = undefined
  query.value = item.name
  resolvedItem.value = item
  typing.value = false
  open.value = false
  createError.value = ''
  emit('select', item)
}

async function create(): Promise<void> {
  if (!canCreate.value || creating.value || props.disabled) return
  creating.value = true
  createError.value = ''
  const name = query.value.trim()
  const parentId = props.parentId
  const version = interactionVersion
  try {
    const item = props.createItem
      ? await props.createItem(name)
      : await createDictionaryItem(props.type, name, parentId)
    // 创建可能已在服务端完成；取消或切换父分类后不把晚响应写回当前字段。
    if (!open.value || version !== interactionVersion || query.value.trim() !== name || props.parentId !== parentId) return
    select({ id: item.id, name: item.name, parentId })
  } catch (cause) {
    if (!open.value || version !== interactionVersion || query.value.trim() !== name || props.parentId !== parentId) return
    const error = normalizeRequestError(cause)
    createError.value = error.fieldErrors.name?.[0] ?? error.message
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="entry-combobox dictionary-combobox">
    <ComboboxField
      :id="inputId"
      :clearable="Boolean(modelValue)"
      :clear-disabled="disabled || creating"
      :label="`${label}${optional ? '（选填）' : ''}`"
      :label-icon="labelIcon"
      :value="query"
      :display-value="selectedItem?.name ?? ''"
      :disabled="disabled"
      :placeholder="!items.length ? '输入名称新增' : '搜索或新增'"
      :candidate-count="request.status.value === 'loading' || request.error.value ? undefined : candidates.length"
      :open="open"
      :invalid="Boolean(error || createError)"
      @clear="emit('clear'); resolvedItem = undefined; query = ''; open = false"
      @open="focus"
      @input="change"
      @submit="debounced.submit(searchTerm)"
      @close="close"
    >
      <small
        v-if="request.status.value === 'loading'"
        class="dropdown-status"
      >正在查询{{ label }}…</small>
      <small
        v-else-if="request.error.value"
        class="dropdown-status field-error"
        role="alert"
      >
        {{ request.error.value.message }}
        <button
          type="button"
          class="compact-action"
          @click="search(searchTerm)"
        >重试</button>
      </small>
      <ul
        v-if="candidates.length"
        class="product-options"
        role="listbox"
      >
        <li
          v-for="item in candidates"
          :key="item.id"
        >
          <button
            type="button"
            role="option"
            :aria-selected="modelValue === item.id"
            @click="select(item)"
          >
            <strong>{{ item.name }}</strong>
          </button>
        </li>
      </ul>
      <div
        v-else-if="request.status.value !== 'loading' && !request.error.value"
        class="dropdown-status"
      >
        暂无匹配选项
      </div>
      <button
        v-if="canCreate"
        type="button"
        class="dropdown-action"
        :disabled="disabled || creating"
        @click="create"
      >
        {{ creating ? '正在新增…' : `新增${label}“${query.trim()}”` }}
      </button>

      <small
        v-if="nameTooLong || createError"
        class="dropdown-status field-error"
        role="alert"
      >{{ nameTooLong ? '名称不能超过 100 个字符。' : createError }}</small>
    </ComboboxField>
    <small
      v-if="error"
      class="field-error"
      role="alert"
    >{{ error }}</small>
  </div>
</template>
