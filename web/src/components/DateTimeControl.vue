<script setup lang="ts">
defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{ modelValue?: string, type?: 'date' | 'datetime-local' }>(), {
  modelValue: '',
  type: 'datetime-local',
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <span class="date-time-control">
    <input
      :type="type"
      :value="modelValue"
      v-bind="$attrs"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
  </span>
</template>
