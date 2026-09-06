<script setup lang="ts">
import DictionaryPicker, { type DictionaryPickerItem } from './DictionaryPicker.vue'

defineProps<{
  items: DictionaryPickerItem[]
  modelValue?: string
  disabled?: boolean
  error?: string
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <DictionaryPicker
    label="购买地点标签"
    optional
    :items="items"
    :model-value="modelValue"
    :disabled="disabled"
    :error="error"
    @update:model-value="$emit('update:modelValue', $event)"
  />
  <small class="field-help">第一期只保存文本标签，不请求定位权限。</small>
</template>
