<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

export interface SettingsDisclosureItem {
  key: string
  label: string
  value: string
  disabled?: boolean
  tone?: 'action' | 'danger'
  disclosure?: boolean
}

defineProps<{
  items: readonly SettingsDisclosureItem[]
  label: string
  centered?: boolean
}>()

defineEmits<{
  select: [key: string]
}>()
</script>

<template>
  <ul
    class="settings-disclosure-list"
    :class="{ 'settings-actions-centered': centered }"
    :aria-label="label"
  >
    <li
      v-for="item in items"
      :key="item.key"
    >
      <button
        type="button"
        :disabled="item.disabled"
        :class="{ 'danger-text': item.tone === 'danger', 'action-text': item.tone === 'action' }"
        @click="$emit('select', item.key)"
      >
        <span>{{ item.label }}</span>
        <span class="disclosure-value">{{ item.value }}</span>
        <ChevronRight
          v-if="item.disclosure !== false"
          :size="18"
          aria-hidden="true"
        />
      </button>
    </li>
    <slot />
  </ul>
</template>
