<script setup lang="ts">
import { canRetryRequest, isAccessDenied, type RequestError } from '../api/errors'
import AppStateBlock from './AppStateBlock.vue'

withDefaults(defineProps<{ error?: RequestError, title: string, compact?: boolean, showRetry?: boolean }>(), {
  error: undefined, compact: false, showRetry: true,
})
defineEmits<{ retry: [] }>()
</script>

<template>
  <small
    v-if="compact"
    class="dropdown-status field-error"
    role="alert"
    :data-error-kind="isAccessDenied(error) ? 'permission' : 'error'"
  >
    {{ error?.message ?? title }}
    <button
      v-if="showRetry && canRetryRequest(error)"
      type="button"
      class="compact-action"
      @click="$emit('retry')"
    >重试</button>
  </small>
  <AppStateBlock
    v-else
    :kind="isAccessDenied(error) ? 'permission' : 'error'"
    :title="title"
    :message="error?.message"
    :action-label="showRetry && canRetryRequest(error) ? '重试' : undefined"
    @action="$emit('retry')"
  />
</template>
