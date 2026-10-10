<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ComboboxField from './ComboboxField.vue'
import { useDebouncedQuery } from '../composables/useDebouncedQuery'
import { useLatestRequest } from '../composables/useLatestRequest'

const props = defineProps<{
  inputId: string
  label: string
  modelValue: string
  suggestions: string[]
  loadSuggestions: (query: string, signal: globalThis.AbortSignal) => Promise<string[]>
  disabled?: boolean
  error?: string
  maxLength?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const query = ref(props.modelValue)
const open = ref(false)
const browsing = ref(false)
const request = useLatestRequest<string[]>()
const searchTerm = computed(() => browsing.value ? '' : query.value)
const candidates = computed(() => (request.data.value ?? props.suggestions)
  .filter((name) => name.toLocaleLowerCase().includes(searchTerm.value.trim().toLocaleLowerCase())))
const newName = computed(() => query.value.trim())
const tooLong = computed(() => [...newName.value].length > (props.maxLength ?? 200))
const canUse = computed(() => !browsing.value && newName.value.length > 0
  && !tooLong.value && !candidates.value.includes(newName.value))
async function search(value: string): Promise<void> {
  await request.execute((signal) => props.loadSuggestions(value.trim(), signal), { isEmpty: (items) => !items.length })
}
const debounced = useDebouncedQuery((value: string) => { void search(value) })
function show(searching: boolean): void {
  browsing.value = !searching
  open.value = true
  debounced.submit(searchTerm.value)
}
function change(value: string): void {
  query.value = value
  browsing.value = false
  debounced.schedule(value)
}
function close(): void {
  open.value = false
  debounced.cancel()
  request.cancel()
  query.value = props.modelValue
}
function select(name: string): void {
  if (props.disabled || [...name].length > (props.maxLength ?? 200)) return
  emit('update:modelValue', name)
  close()
  query.value = name
}
watch(() => props.modelValue, (value) => { if (!open.value) query.value = value })
</script>

<template>
  <div class="entry-combobox entry-subject-field">
    <ComboboxField
      :id="inputId"
      :clearable="Boolean(modelValue)"
      :clear-disabled="disabled"
      :label="label"
      :value="query"
      :display-value="modelValue"
      :disabled="disabled"
      :placeholder="`搜索或填写${label}`"
      :selection-placeholder="`选择或填写${label}`"
      :search-label="`搜索或填写${label}`"
      :open="open"
      :invalid="Boolean(error)"
      :max-length="maxLength ?? 200"
      :candidate-count="candidates.length"
      @clear="select('')"
      @open="show"
      @input="change"
      @submit="newName ? select(newName) : debounced.submit(searchTerm)"
      @close="close"
    >
      <small
        v-if="request.status.value === 'loading'"
        class="dropdown-status"
      >正在查询最近名称…</small>
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
          v-for="name in candidates"
          :key="name"
        >
          <button
            type="button"
            role="option"
            :aria-selected="modelValue === name"
            @click="select(name)"
          >
            {{ name }}
          </button>
        </li>
      </ul>
      <small
        v-else-if="request.status.value !== 'loading'"
        class="dropdown-status"
      >暂无最近名称，可搜索或填写新的名称。</small>
      <button
        v-if="canUse"
        type="button"
        class="dropdown-action"
        :disabled="disabled"
        @click="select(newName)"
      >
        使用“{{ newName }}”
      </button>

      <small
        v-if="tooLong"
        class="dropdown-status field-error"
        role="alert"
      >名称不能超过 {{ maxLength ?? 200 }} 个字符。</small>
    </ComboboxField>
    <small
      v-if="error"
      class="field-error"
      role="alert"
    >{{ error }}</small>
  </div>
</template>
