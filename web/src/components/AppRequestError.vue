<script setup lang="ts">
import { canRetryRequest, isAccessDenied, type RequestError } from '../api/errors'
import AppStateBlock from './AppStateBlock.vue'

defineProps<{ error?: RequestError, title: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <AppStateBlock
    :kind="isAccessDenied(error) ? 'permission' : 'error'"
    :title="title"
    :message="error?.message"
    :action-label="canRetryRequest(error) ? '重试' : undefined"
    @action="$emit('retry')"
  />
</template>
