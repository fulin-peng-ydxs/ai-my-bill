<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  id: string
  label: string
  modelValue: string
  options: readonly { value: string, label: string }[]
  showLabel?: boolean
  describedBy?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const selectedLabel = computed(() => props.options.find(item => item.value === props.modelValue)?.label ?? props.modelValue)
</script>

<template>
  <label
    class="compact-select"
    :for="id"
  >
    <span
      class="filter-chip-content"
      aria-hidden="true"
    >
      <span><span
        v-if="showLabel"
        class="filter-chip-label"
      >{{ label }}：</span><strong>{{ selectedLabel }}</strong></span>
      <ChevronDown :size="12" />
    </span>
    <select
      :id="id"
      class="select-control"
      :aria-label="label"
      :aria-describedby="describedBy"
      :value="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
      >{{ option.label }}</option>
    </select>
  </label>
</template>
