<script setup lang="ts">
defineOptions({ inheritAttrs: false })

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <span class="date-time-control">
    <input
      type="datetime-local"
      :value="modelValue"
      v-bind="$attrs"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
  </span>
</template>
