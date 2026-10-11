<script setup lang="ts">
import type { RequestError } from '../api/errors'
import type { DataRegionStatus } from '../composables/useLatestRequest'
import AppRequestError from './AppRequestError.vue'
import { useDelayedLoading } from '../composables/useDelayedLoading'

// idle 可展示调用方已成功预载的候选，但不能据此把尚未请求的数据判为空。
const props = defineProps<{
  status: DataRegionStatus
  error?: RequestError
  hasCandidates: boolean
  loadingMessage: string
  emptyMessage: string
}>()
const loadingVisible = useDelayedLoading(() => props.status === 'loading')
defineEmits<{ retry: [] }>()
</script>

<template>
  <small
    v-if="status === 'loading'"
    class="dropdown-status"
    role="status"
    aria-busy="true"
  ><span
    :class="{ 'loading-placeholder': !loadingVisible }"
    :aria-hidden="!loadingVisible || undefined"
  >{{ loadingMessage }}</span></small>
  <AppRequestError
    v-else-if="status === 'error'"
    compact
    title="候选加载失败"
    :error="error"
    @retry="$emit('retry')"
  />
  <template v-else>
    <slot v-if="hasCandidates" />
    <small
      v-else-if="status === 'ready' || status === 'empty'"
      class="dropdown-status"
      role="status"
    >{{ emptyMessage }}</small>
  </template>
</template>
