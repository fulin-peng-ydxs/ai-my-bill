<script setup lang="ts">
import DictionaryPicker, { type DictionaryPickerItem } from './DictionaryPicker.vue'

defineProps<{
  items: DictionaryPickerItem[]
  label?: string
  modelValue?: string
  disabled?: boolean
  error?: string
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <DictionaryPicker
    :label="label ?? '支付方式'"
    :items="items"
    :model-value="modelValue"
    :disabled="disabled"
    :error="error"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>
