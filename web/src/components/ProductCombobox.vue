<script setup lang="ts">
import { computed, ref, watch } from 'vue'

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
const listOpen = ref(true)
const createError = ref<string>()
const creating = ref(false)
const request = useLatestRequest<ProductSuggestion[]>()
const exactMatch = computed(() => {
  const normalizedQuery = normalizeDictionaryName(query.value)
  return request.data.value?.some((item) => normalizeDictionaryName(item.name) === normalizedQuery) ?? false
})
const canCreate = computed(() => query.value.trim().length > 0 && query.value.trim().length <= 200 && !exactMatch.value)

async function search(value: string): Promise<void> {
  await request.execute((signal) => listExpenseProducts(value.trim(), signal).then((response) => response.items), {
    isEmpty: (items) => items.length === 0,
  })
}

const debounced = useDebouncedQuery((value: string) => { void search(value) })

function changeQuery(value: string): void {
  query.value = value
  listOpen.value = true
  createError.value = undefined
  if (props.modelValue && value !== props.modelName) emit('clear')
  debounced.schedule(value)
}

function select(item: ProductSuggestion): void {
  query.value = item.name
  listOpen.value = false
  createError.value = undefined
  emit('select', item)
}

async function createProduct(): Promise<void> {
  if (!canCreate.value || creating.value) return
  creating.value = true
  createError.value = undefined
  try {
    const created = await createDictionaryItem('product', query.value.trim())
    select({ id: created.id, name: created.name })
    await search(created.name)
  } catch (error) {
    createError.value = normalizeRequestError(error).message
  } finally {
    creating.value = false
  }
}

function reset(): void {
  query.value = ''
  listOpen.value = true
  createError.value = undefined
  void search('')
}

defineExpose({ reset })

watch(() => props.modelName, (value) => {
  if (props.modelValue && value && value !== query.value) query.value = value
})
void search(query.value)
</script>

<template>
  <div class="product-combobox">
    <label for="expense-product-search">商品名称</label>
    <input
      id="expense-product-search"
      :value="query"
      :disabled="disabled"
      autocomplete="off"
      placeholder="搜索或输入新商品"
      role="combobox"
      :aria-expanded="listOpen && Boolean(request.data.value?.length)"
      aria-controls="expense-product-options"
      :aria-invalid="Boolean(error)"
      @input="changeQuery(($event.target as HTMLInputElement).value)"
      @focus="listOpen = true"
      @keydown.enter.prevent="debounced.submit(query)"
      @keydown.escape="listOpen = false"
    >
    <small v-if="request.status.value === 'loading'">正在查询商品…</small>
    <small
      v-else-if="request.error.value"
      class="field-error"
      role="alert"
    >{{ request.error.value.message }} <button
      type="button"
      class="inline-action"
      @click="search(query)"
    >重试</button></small>
    <ul
      v-if="listOpen && request.data.value?.length"
      id="expense-product-options"
      class="product-options"
      role="listbox"
    >
      <li
        v-for="item in request.data.value"
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
    <button
      v-if="canCreate"
      type="button"
      class="secondary-button product-create-button"
      :disabled="disabled || creating"
      @click="createProduct"
    >
      {{ creating ? '正在新增…' : `新增商品“${query.trim()}”` }}
    </button>
    <small
      v-if="error || createError"
      class="field-error"
      role="alert"
    >{{ error || createError }}</small>
  </div>
</template>
