<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'

import { useDebouncedQuery } from '../composables/useDebouncedQuery'

const props = withDefaults(defineProps<{
  id: string
  modelValue: string
  label?: string
  placeholder?: string
  delay?: number
}>(), {
  label: '搜索账目',
  placeholder: '搜索名称、分类、付款方或备注',
  delay: 300,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  search: [value: string]
}>()
const query = useDebouncedQuery((value: string) => emit('search', value), props.delay)

function inputValue(event: unknown): string {
  return (event as { target: { value: string } }).target.value
}

function onInput(event: unknown): void {
  const value = inputValue(event)
  emit('update:modelValue', value)
  if (value === '') query.submit(value)
  else query.schedule(value)
}

function onEnter(event: unknown): void {
  const keyboardEvent = event as { isComposing: boolean; preventDefault: () => void }
  if (keyboardEvent.isComposing) return
  keyboardEvent.preventDefault()
  query.submit(inputValue(event))
}

function clear(): void {
  emit('update:modelValue', '')
  query.submit('')
}
</script>

<template>
  <div class="global-search">
    <label
      class="sr-only"
      :for="id"
    >{{ label }}</label>
    <Search
      :size="18"
      aria-hidden="true"
    />
    <input
      :id="id"
      type="search"
      enterkeyhint="search"
      :value="modelValue"
      :placeholder="placeholder"
      @input="onInput"
      @keydown.enter="onEnter"
    >
    <button
      v-if="modelValue"
      type="button"
      class="icon-button"
      aria-label="清空搜索"
      @click="clear"
    >
      <X
        :size="18"
        aria-hidden="true"
      />
    </button>
  </div>
</template>
