<script setup lang="ts">
import type { EntryType } from '../domain/preferences'
import SegmentedControl from './SegmentedControl.vue'

withDefaults(defineProps<{ modelValue: EntryType, disabled?: boolean, label?: string }>(), {
  disabled: false,
  label: '本次记账类型',
})
defineEmits<{ 'update:modelValue': [value: EntryType] }>()

const options = [
  { value: 'EXPENSE', label: '支出' },
  { value: 'INCOME', label: '收入' },
] as const
</script>

<template>
  <SegmentedControl
    class="entry-type-switch"
    :label="label"
    :model-value="modelValue"
    :options="options.map((option) => ({ ...option, disabled }))"
    @update:model-value="$emit('update:modelValue', $event as EntryType)"
  />
</template>
