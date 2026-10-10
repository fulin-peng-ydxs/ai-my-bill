<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays } from 'lucide-vue-next'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{ modelValue?: string, type?: 'date' | 'datetime-local', indicator?: boolean }>(), {
  modelValue: '',
  type: 'datetime-local',
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
// 只格式化上海墙上时间字符串，不经 Date 转换，避免设备时区改变业务值。
const displayValue = computed(() => props.modelValue.slice(0, 16).replaceAll('-', '/').replace('T', ' '))
</script>

<template>
  <span
    class="date-time-control"
    :class="{ 'date-time-with-indicator': indicator }"
  >
    <span
      class="date-time-value"
      aria-hidden="true"
    >{{ displayValue || '选择日期' }}</span>
    <input
      :type="type"
      :value="modelValue"
      v-bind="$attrs"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
    <CalendarDays
      v-if="indicator"
      class="date-time-indicator"
      :size="17"
      :stroke-width="1.7"
      aria-hidden="true"
    />
  </span>
</template>
