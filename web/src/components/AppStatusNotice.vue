<script setup lang="ts">
import { ChevronDown, TriangleAlert } from 'lucide-vue-next'
import { canRetryRequest, type RequestError } from '../api/errors'
import { ref } from 'vue'
import { useDisclosureMotion } from '../composables/useDisclosureMotion'

const details = ref<globalThis.HTMLDetailsElement>()
const disclosure = useDisclosureMotion(details)

defineProps<{ title: string, message?: string, error?: RequestError, actionLabel?: string, busy?: boolean }>()
defineEmits<{ action: [] }>()
</script>

<template>
  <details
    ref="details"
    class="status-notice"
  >
    <summary @click="disclosure.toggle">
      <TriangleAlert
        :size="16"
        aria-hidden="true"
      />
      <span>{{ title }}</span>
      <ChevronDown
        :size="14"
        class="status-notice-chevron"
        aria-hidden="true"
      />
    </summary>
    <div
      class="status-notice-detail"
      role="status"
    >
      <span v-if="message || error">{{ message ?? error?.message }}</span>
      <button
        v-if="actionLabel && (!error || canRetryRequest(error))"
        type="button"
        class="text-action"
        :disabled="busy"
        @click="$emit('action')"
      >
        {{ actionLabel }}
      </button>
    </div>
  </details>
</template>

<style scoped>
.status-notice { color: var(--color-warning-text); }
.status-notice summary { display: flex; align-items: center; gap: var(--space-sm); min-height: var(--control-height); width: fit-content; max-width: 100%; cursor: pointer; font-size: 12px; list-style: none; }
.status-notice summary::-webkit-details-marker { display: none; }
.status-notice summary:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.status-notice summary > svg { flex: 0 0 auto; }
.status-notice[open] .status-notice-chevron { transform: rotate(180deg); }
.status-notice-detail { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); color: var(--color-muted); font-size: 12px; padding-bottom: var(--space-sm); overflow-wrap: anywhere; }
</style>
