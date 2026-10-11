<script setup lang="ts">
import { computed } from 'vue'
export interface SegmentedOption {
  value: string
  label: string
  disabled?: boolean
}

const props = defineProps<{
  label: string
  modelValue: string
  options: readonly SegmentedOption[]
}>()
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue))

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <fieldset
    class="segmented-control"
    :style="{ '--segment-count': options.length, '--segment-index': Math.max(0, selectedIndex) }"
  >
    <legend class="sr-only">
      {{ label }}
    </legend>
    <span
      v-if="selectedIndex >= 0"
      class="segmented-indicator"
      aria-hidden="true"
    />
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
