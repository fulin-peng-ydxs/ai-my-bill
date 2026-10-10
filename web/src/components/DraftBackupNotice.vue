<script setup lang="ts">
import { inject, onActivated, onDeactivated, ref, useId, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { pageNoticeTarget } from '../composables/pageActionTarget'
import AppDialog from './AppDialog.vue'
import { accountStorageSupportProblem } from '../storage/accountStorage'

const props = defineProps<{ message?: string, retry: () => Promise<void> }>()
const busy = ref(false)
const open = ref(false)
const dialogId = useId()
const target = inject(pageNoticeTarget, undefined)
const active = ref(true)
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false; open.value = false })
watch(() => props.message, (message) => { if (!message) open.value = false })
const canRetry = !accountStorageSupportProblem()
async function retryBackup(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try { await props.retry() } finally { busy.value = false }
}
</script>

<template>
  <Teleport
    :to="target ?? 'body'"
    :disabled="!target"
  >
    <button
      v-if="message && active"
      type="button"
      class="compact-action draft-backup-notice"
      aria-label="草稿未备份，查看说明"
      @click="open = true"
    >
      <TriangleAlert
        :size="15"
        aria-hidden="true"
      /><span>草稿未备份</span>
    </button>
  </Teleport>
  <AppDialog
    :id="dialogId"
    v-model:open="open"
    title="草稿暂未保存"
    description="本次填写仍可保存成账目。当前无法自动备份，刷新或关闭页面后可能无法恢复。"
    :confirm-label="canRetry ? busy ? '重试中…' : '重试备份' : '知道了'"
    :show-cancel="canRetry"
    cancel-label="关闭"
    :busy="busy"
    @confirm="canRetry ? retryBackup() : open = false"
  />
</template>
