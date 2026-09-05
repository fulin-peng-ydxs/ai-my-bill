<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

export interface SettingsDisclosureItem {
  key: string
  label: string
  value: string
  disabled?: boolean
}

defineProps<{
  items: readonly SettingsDisclosureItem[]
  label: string
}>()

defineEmits<{
  select: [key: string]
}>()
</script>

<template>
  <ul
    class="settings-disclosure-list"
    :aria-label="label"
  >
    <li
      v-for="item in items"
      :key="item.key"
    >
      <button
        type="button"
        :disabled="item.disabled"
        @click="$emit('select', item.key)"
      >
        <span>{{ item.label }}</span>
        <span class="disclosure-value">{{ item.value }}</span>
        <ChevronRight
          :size="18"
          aria-hidden="true"
        />
      </button>
    </li>
  </ul>
</template>
