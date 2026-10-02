<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { createDictionaryItem, getDictionaryItem, listDictionaryCandidates, listDictionaryItems } from '../api/dictionaries'
import { normalizeRequestError } from '../api/errors'
import { useDebouncedQuery } from '../composables/useDebouncedQuery'
import { useLatestRequest } from '../composables/useLatestRequest'
import { normalizeDictionaryName, type DictionaryType } from '../domain/dictionaries'

export interface DictionaryChoice { id: string, name: string, parentId?: string }

const props = defineProps<{
  type: DictionaryType
  label: string
  items: DictionaryChoice[]
  modelValue?: string
  parentId?: string
  optional?: boolean
  disabled?: boolean
  error?: string
  inputId: string
}>()
const emit = defineEmits<{ select: [item: DictionaryChoice], clear: [] }>()

const query = ref('')
const open = ref(false)
const typing = ref(false)
const creating = ref(false)
const createError = ref('')
const searchedQuery = ref<string>()
const resolvedItem = ref<DictionaryChoice>()
const request = useLatestRequest<DictionaryChoice[]>()
const normalizedQuery = computed(() => normalizeDictionaryName(query.value))
const candidates = computed(() => {
  const source = searchedQuery.value === query.value && request.data.value ? request.data.value : props.items
  const choices = resolvedItem.value && !source.some((item) => item.id === resolvedItem.value?.id)
    ? [...source, resolvedItem.value] : source
  return choices.filter((item) => normalizeDictionaryName(item.name).includes(normalizedQuery.value))
})
const exactMatch = computed(() => [...candidates.value, ...props.items]
  .some((item) => normalizeDictionaryName(item.name) === normalizedQuery.value))
const canCreate = computed(() => normalizedQuery.value.length > 0 && !exactMatch.value)

watch([() => props.modelValue, () => props.items], (_, __, onCleanup) => {
  if (props.modelValue) {
    const selected = props.items.find((item) => item.id === props.modelValue)
    if (selected) {
      resolvedItem.value = undefined
      query.value = selected.name
      typing.value = false
    } else {
      resolvedItem.value = undefined
      query.value = ''
      const controller = new globalThis.AbortController()
      onCleanup(() => controller.abort())
      void getDictionaryItem(props.type, props.modelValue, controller.signal).then((item) => {
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
  await request.execute((signal) => props.type === 'expense-category'
    ? listDictionaryItems(props.type, value.trim(), 'ACTIVE', signal, 0, 100,
      props.parentId ? { parentId: props.parentId } : { rootsOnly: true }).then((page) => page.items)
    : listDictionaryCandidates(props.type, value.trim(), signal).then((page) => page.items), {
    isEmpty: (items) => items.length === 0,
  })
}
const debounced = useDebouncedQuery((value: string) => { void search(value) })

function change(value: string): void {
  query.value = value
  typing.value = true
  open.value = true
  createError.value = ''
  if (props.modelValue) emit('clear')
  debounced.schedule(value)
}

function select(item: DictionaryChoice): void {
  debounced.cancel()
  request.cancel()
  searchedQuery.value = undefined
  query.value = item.name
  typing.value = false
  open.value = false
  createError.value = ''
  emit('select', item)
}

async function create(): Promise<void> {
  if (!canCreate.value || creating.value || props.disabled) return
  if ([...query.value.trim()].length > 100) {
    createError.value = '名称不能超过 100 个字符。'
    return
  }
  creating.value = true
  createError.value = ''
  try {
    const item = await createDictionaryItem(props.type, query.value.trim(), props.parentId)
    select({ id: item.id, name: item.name, parentId: props.parentId })
  } catch (cause) {
    const error = normalizeRequestError(cause)
    createError.value = error.fieldErrors.name?.[0] ?? error.message
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="entry-combobox dictionary-combobox">
    <label :for="inputId">{{ label }}{{ optional ? '（选填）' : '' }}</label>
    <input
      :id="inputId"
      :value="query"
      :disabled="disabled"
      autocomplete="off"
      :placeholder="!items.length ? '输入名称新增' : '搜索或新增'"
      role="combobox"
      :aria-expanded="open && Boolean(candidates.length)"
      :aria-controls="`${inputId}-options`"
      :aria-invalid="Boolean(error || createError)"
      @input="change(($event.target as HTMLInputElement).value)"
      @focus="open = true; search(query)"
      @keydown.enter.prevent="debounced.submit(query)"
      @keydown.escape="open = false"
    >
    <small v-if="request.status.value === 'loading'">正在查询{{ label }}…</small>
    <small
      v-else-if="request.error.value"
      class="field-error"
      role="alert"
    >
      {{ request.error.value.message }}
      <button
        type="button"
        class="inline-action"
        @click="search(query)"
      >重试</button>
    </small>
    <ul
      v-if="open && candidates.length"
      :id="`${inputId}-options`"
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
    <button
      v-if="canCreate"
      type="button"
      class="secondary-button product-create-button"
      :disabled="disabled || creating"
      @click="create"
    >
      {{ creating ? '正在新增…' : `新增${label}“${query.trim()}”` }}
    </button>
    <small
      v-if="error || createError"
      class="field-error"
      role="alert"
    >{{ error || createError }}</small>
  </div>
</template>
