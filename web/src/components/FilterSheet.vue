<script setup lang="ts">
import AppDrawer from './AppDrawer.vue'

withDefaults(defineProps<{
  id: string
  open: boolean
  title?: string
  busy?: boolean
  applyLabel?: string
}>(), {
  title: '筛选',
  busy: false,
  applyLabel: '应用筛选',
})

defineEmits<{
  'update:open': [value: boolean]
  apply: []
}>()
</script>

<template>
  <AppDrawer
    :id="id"
    :open="open"
    :title="title"
    description="调整中的条件只有在应用后才会更新页面结果。"
    @update:open="$emit('update:open', $event)"
  >
    <form
      :id="`${id}-form`"
      class="filter-form"
      @submit.prevent="$emit('apply')"
    >
      <slot />
    </form>
    <template #footer>
      <button
        type="button"
        class="secondary-button"
        :disabled="busy"
        @click="$emit('update:open', false)"
      >
        取消
      </button>
      <button
        type="submit"
        class="primary-button"
        :form="`${id}-form`"
        :disabled="busy"
      >
        {{ busy ? '正在应用…' : applyLabel }}
      </button>
    </template>
  </AppDrawer>
</template>
