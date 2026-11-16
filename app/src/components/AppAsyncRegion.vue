<script setup lang="ts">
import type { RequestError } from '../api/errors'
import type { DataRegionStatus } from '../composables/useLatestRequest'
import AppStateBlock from './AppStateBlock.vue'
import AppRequestError from './AppRequestError.vue'
import AppStatusNotice from './AppStatusNotice.vue'

// 只统一区域呈现与恢复入口；查询条件、快照及分页一致性由调用方负责。
withDefaults(defineProps<{
  status: DataRegionStatus
  error?: RequestError
  staleWarning?: RequestError
  refreshing?: boolean
  loadingTitle?: string
  loadingMessage?: string
  errorTitle?: string
  emptyTitle?: string
  emptyMessage?: string
  emptyActionLabel?: string
  staleTitle?: string
}>(), {
  loadingTitle: '正在加载', errorTitle: '暂时无法加载', emptyTitle: '暂无数据', staleTitle: '数据可能不是最新',
  error: undefined, staleWarning: undefined, loadingMessage: undefined, emptyMessage: undefined, emptyActionLabel: undefined,
})
defineEmits<{ retry: [], staleRetry: [], emptyAction: [] }>()
</script>

<template>
  <AppStateBlock
    v-if="status === 'loading'"
    kind="loading"
    :title="loadingTitle"
    :message="loadingMessage"
  />
  <AppRequestError
    v-else-if="status === 'error'"
    :error="error"
    :title="errorTitle"
    @retry="$emit('retry')"
  />
  <template v-else-if="status === 'ready' || status === 'empty'">
    <AppStatusNotice
      v-if="staleWarning"
      :title="staleTitle"
      :error="staleWarning"
      :message="`${staleWarning.message} 当前仍显示上次成功结果。`"
      action-label="重试"
      :busy="refreshing"
      @action="$emit('staleRetry')"
    />
    <AppStateBlock
      v-if="status === 'empty'"
      kind="empty"
      :title="emptyTitle"
      :message="emptyMessage"
      :action-label="emptyActionLabel"
      @action="$emit('emptyAction')"
    />
    <slot v-else />
  </template>
</template>
