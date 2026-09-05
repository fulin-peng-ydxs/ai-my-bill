<script setup lang="ts">
export interface SegmentedOption {
  value: string
  label: string
  disabled?: boolean
}

defineProps<{
  label: string
  modelValue: string
  options: readonly SegmentedOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <fieldset class="segmented-control">
    <legend class="sr-only">
      {{ label }}
    </legend>
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="modelValue === option.value"
      :disabled="option.disabled"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </fieldset>
</template>
