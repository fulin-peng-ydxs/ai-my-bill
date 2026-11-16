<script setup lang="ts">
import DictionaryPicker, { type DictionaryPickerItem } from './DictionaryPicker.vue'

defineProps<{
  items: DictionaryPickerItem[]
  modelValue?: string
  disabled?: boolean
  error?: string
}>()
defineEmits<{ 'update:modelValue': [value: string], selected: [item: DictionaryPickerItem] }>()
</script>

<template>
  <DictionaryPicker
    type="location"
    input-id="expense-location-label"
    label="购买地点标签"
    optional
    :items="items"
    :model-value="modelValue"
    :disabled="disabled"
    :error="error"
    @update:model-value="$emit('update:modelValue', $event)"
    @selected="$emit('selected', $event)"
  />
</template>
