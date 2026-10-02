<script setup lang="ts">
import type { DictionaryType } from '../domain/dictionaries'
import DictionaryCombobox, { type DictionaryChoice } from './DictionaryCombobox.vue'

export type DictionaryPickerItem = DictionaryChoice

const props = defineProps<{
  type: DictionaryType
  inputId: string
  label: string
  items: DictionaryPickerItem[]
  modelValue?: string
  optional?: boolean
  disabled?: boolean
  error?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string], selected: [item: DictionaryChoice] }>()
function select(item: DictionaryChoice): void {
  emit('selected', item)
  emit('update:modelValue', item.id)
}
</script>

<template>
  <DictionaryCombobox
    :input-id="props.inputId"
    :type="props.type"
    :label="props.label"
    :items="props.items"
    :model-value="props.modelValue"
    :optional="props.optional"
    :disabled="props.disabled"
    :error="props.error"
    @select="select"
    @clear="emit('update:modelValue', '')"
  />
</template>
