<script setup lang="ts">
import { ref } from 'vue'
import AppStateBlock from './AppStateBlock.vue'
import { accountStorageSupportProblem } from '../storage/accountStorage'

const props = defineProps<{ message?: string, retry: () => Promise<void> }>()
const busy = ref(false)
const canRetry = !accountStorageSupportProblem()
async function retryBackup(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try { await props.retry() } finally { busy.value = false }
}
</script>

<template>
  <AppStateBlock
    v-if="message"
    kind="error"
    title="草稿暂未保存"
    message="请先保存账目，避免离开后丢失。"
    :action-label="canRetry ? busy ? '重试中…' : '重试' : undefined"
    :action-disabled="busy"
    @action="retryBackup"
  />
</template>
