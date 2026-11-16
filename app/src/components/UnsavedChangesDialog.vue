<script setup lang="ts">
import {
  cancelDiscardChanges,
  confirmDiscardChanges,
  useUnsavedChangesState,
} from '../composables/unsavedChanges'
import AppDialog from './AppDialog.vue'

const state = useUnsavedChangesState()
</script>

<template>
  <AppDialog
    id="unsaved-changes-confirm"
    :open="state.open.value"
    title="放弃未保存内容？"
    description="离开后，本次尚未提交的更改将被清除。"
    confirm-label="放弃并离开"
    cancel-label="继续编辑"
    :busy="state.discarding.value"
    danger
    @update:open="cancelDiscardChanges"
    @confirm="confirmDiscardChanges"
  />
</template>
