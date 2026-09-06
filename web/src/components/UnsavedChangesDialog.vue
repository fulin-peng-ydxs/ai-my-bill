<script setup lang="ts">
import { computed } from 'vue'
import {
  cancelDiscardChanges,
  confirmDiscardChanges,
  useUnsavedChangesState,
} from '../composables/unsavedChanges'
import AppDialog from './AppDialog.vue'

const state = useUnsavedChangesState()
const isLogout = computed(() => state.reason.value === 'logout' || state.reason.value === 'account-change')
</script>

<template>
  <AppDialog
    id="unsaved-changes-confirm"
    :open="state.open.value"
    :title="isLogout ? '确认离开当前账号？' : '放弃未保存内容？'"
    :description="isLogout
      ? '未提交账目草稿会安全保留，偏好中尚未同步的更改会被放弃。'
      : '离开后，本次尚未提交的更改将被清除。'"
    :confirm-label="isLogout ? '确认离开' : '放弃并离开'"
    cancel-label="继续编辑"
    :busy="state.discarding.value"
    danger
    @update:open="cancelDiscardChanges"
    @confirm="confirmDiscardChanges"
  />
</template>
