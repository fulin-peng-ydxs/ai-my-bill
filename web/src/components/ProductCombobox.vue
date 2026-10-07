<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import ComboboxField from './ComboboxField.vue'

import { createDictionaryItem } from '../api/dictionaries'
import { listExpenseProducts, type ProductSuggestion } from '../api/expenses'
import { normalizeRequestError } from '../api/errors'
import { useDebouncedQuery } from '../composables/useDebouncedQuery'
import { useLatestRequest } from '../composables/useLatestRequest'
import { normalizeDictionaryName } from '../domain/dictionaries'

const props = withDefaults(defineProps<{
  modelValue?: string
  modelName?: string
  disabled?: boolean
  error?: string
}>(), { modelValue: '', modelName: '', disabled: false, error: undefined })

const emit = defineEmits<{
  select: [value: ProductSuggestion]
  clear: []
}>()

const query = ref(props.modelName)
const browsing = ref(false)
const listOpen = ref(false)
const createError = ref<string>()
const creating = ref(false)
const request = useLatestRequest<ProductSuggestion[]>()
const searchedQuery = ref<string>()
const searchTerm = computed(() => browsing.value ? '' : query.value)
const candidates = computed(() => (request.data.value ?? []).filter((item) =>
  normalizeDictionaryName(item.name).includes(normalizeDictionaryName(searchTerm.value))))
const exactMatch = computed(() => {
  const normalizedQuery = normalizeDictionaryName(query.value)
  return candidates.value.some((item) => normalizeDictionaryName(item.name) === normalizedQuery)
})
const nameTooLong = computed(() => [...query.value.trim()].length > 200)
const canCreate = computed(() => !browsing.value && query.value.trim().length > 0 && !nameTooLong.value && !exactMatch.value)

async function search(value: string): Promise<void> {
  searchedQuery.value = value
  await request.execute((signal) => listExpenseProducts(value.trim(), signal).then((response) => response.items), {
    isEmpty: (items) => items.length === 0,
  })
}

const debounced = useDebouncedQuery((value: string) => { void search(value) })

function focus(searching: boolean): void {
  browsing.value = !searching
  listOpen.value = true
  if (searchedQuery.value !== searchTerm.value || !request.data.value) void search(searchTerm.value)
}

function changeQuery(value: string): void {
  browsing.value = false
  query.value = value
  listOpen.value = true
  createError.value = undefined
  if (props.modelValue && value !== props.modelName) emit('clear')
  debounced.schedule(value)
}

function select(item: ProductSuggestion): void {
  debounced.cancel()
  request.cancel()
  query.value = item.name
  listOpen.value = false
  createError.value = undefined
  emit('select', item)
}

async function createProduct(): Promise<void> {
  if (!canCreate.value || creating.value || props.disabled) return
  creating.value = true
  createError.value = undefined
  try {
    const created = await createDictionaryItem('product', query.value.trim())
    select({ id: created.id, name: created.name })
  } catch (error) {
    createError.value = normalizeRequestError(error).message
  } finally {
    creating.value = false
  }
}

function close(): void {
  listOpen.value = false
  debounced.cancel()
  request.cancel()
  query.value = props.modelValue ? props.modelName : ''
  createError.value = undefined
}

function reset(): void {
  debounced.cancel()
  query.value = ''
  searchedQuery.value = undefined
  listOpen.value = false
  createError.value = undefined
  request.cancel()
}

defineExpose({ reset })

watch(() => props.modelName, (value) => {
  if (props.modelValue && value && value !== query.value) query.value = value
})
</script>

<template>
  <div class="entry-combobox product-combobox">
    <ComboboxField
      id="expense-product-search"
      label="商品名称"
      :value="query"
      :disabled="disabled"
      placeholder="搜索或输入新商品"
      :open="listOpen"
      :invalid="Boolean(error || createError)"
      @open="focus"
      @input="changeQuery"
      @submit="debounced.submit(searchTerm)"
      @close="close"
    >
      <small
        v-if="request.status.value === 'loading'"
        class="dropdown-status"
      >正在查询商品…</small>
      <small
        v-else-if="request.error.value"
        class="dropdown-status field-error"
        role="alert"
      >
        {{ request.error.value.message }} <button
          type="button"
          class="inline-action"
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
            <span>{{ item.lastUnitPrice ? `最近 ¥${item.lastUnitPrice}` : '尚无最近价格' }}</span>
          </button>
        </li>
      </ul>
      <div
        v-else-if="request.status.value !== 'loading'"
        class="dropdown-status"
      >
        暂无匹配商品
      </div>
      <button
        v-if="canCreate"
        type="button"
        class="dropdown-action"
        :disabled="disabled || creating"
        @click="createProduct"
      >
        {{ creating ? '正在新增…' : `＋ 新增商品“${query.trim()}”` }}
      </button>
      <small
        v-if="nameTooLong || createError"
        class="dropdown-status field-error"
        role="alert"
      >{{ nameTooLong ? '商品名称不能超过 200 个字符。' : createError }}</small>
    </ComboboxField>
    <small
      v-if="error || createError"
      class="field-error"
      role="alert"
    >{{ error || createError }}</small>
  </div>
</template>
