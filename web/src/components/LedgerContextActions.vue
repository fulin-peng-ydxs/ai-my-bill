<script setup lang="ts">
import AppDrawer from './AppDrawer.vue'

export interface LedgerContextAction {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
}

defineProps<{
  id: string
  open: boolean
  title: string
  actions: readonly LedgerContextAction[]
  description?: string
}>()

defineEmits<{
  'update:open': [value: boolean]
  select: [key: string]
}>()
</script>

<template>
  <AppDrawer
    :id="id"
    :open="open"
    :title="title"
    :description="description ?? '选择要对这条账目执行的操作。'"
    @update:open="$emit('update:open', $event)"
  >
    <div class="context-action-list">
      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        :class="{ 'danger-text': action.danger }"
        :disabled="action.disabled"
        @click="$emit('select', action.key)"
      >
        {{ action.label }}
      </button>
    </div>
  </AppDrawer>
</template>
