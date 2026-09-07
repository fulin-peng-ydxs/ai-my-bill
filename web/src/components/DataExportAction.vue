<script setup lang="ts">
import { ChevronRight, Download, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'

import { cancelExport, createExport, downloadExport, getExport, type ExportRequest, type ExportResponse } from '../api/exports'
import { normalizeRequestError } from '../api/errors'
import { createIdempotencyAttemptTracker } from '../domain/idempotency'

const props = withDefaults(defineProps<{
  request: ExportRequest
  presentation?: 'icon' | 'setting'
}>(), { presentation: 'icon' })

const emit = defineEmits<{ notify: [message: string, kind: 'success' | 'error'] }>()
const task = ref<ExportResponse>()
const submitting = ref(false)
const attempt = createIdempotencyAttemptTracker()
let timer: ReturnType<typeof globalThis.setTimeout> | undefined
let polling: globalThis.AbortController | undefined
let pollErrorShown = false

const working = computed(() => submitting.value || task.value?.status === 'PENDING' || task.value?.status === 'RUNNING')
const actionLabel = computed(() => working.value ? '取消数据导出' : task.value?.status === 'FAILED' ? '重试数据导出' : '导出数据')
const settingValue = computed(() => {
  if (submitting.value || task.value?.status === 'PENDING') return '等待生成'
  if (task.value?.status === 'RUNNING') return '正在生成'
  if (task.value?.status === 'FAILED') return '生成失败，点击重试'
  return 'CSV · 24 小时有效'
})

function notify(message: string, kind: 'success' | 'error' = 'success'): void {
  emit('notify', message, kind)
}

async function act(): Promise<void> {
  if (working.value) { await cancel(); return }
  submitting.value = true
  try {
    task.value = await createExport(props.request, attempt.keyFor(props.request))
    schedulePoll(0)
  } catch (cause) {
    notify(normalizeRequestError(cause).message, 'error')
  } finally {
    submitting.value = false
  }
}

async function cancel(): Promise<void> {
  if (!task.value) return
  submitting.value = true
  clearPoll()
  try {
    task.value = await cancelExport(task.value.id)
    if (task.value.status === 'CANCELLED') {
      notify('导出已取消，未保留文件。')
      reset()
    } else {
      notify('已请求取消，正在停止导出。')
      schedulePoll(500)
    }
  } catch (cause) {
    notify(normalizeRequestError(cause).message, 'error')
    schedulePoll()
  } finally {
    submitting.value = false
  }
}

function schedulePoll(delay = 1000): void {
  clearPoll()
  timer = globalThis.setTimeout(() => { void poll() }, delay)
}

async function poll(): Promise<void> {
  if (!task.value) return
  polling = new globalThis.AbortController()
  try {
    task.value = await getExport(task.value.id, polling.signal)
    pollErrorShown = false
    if (task.value.status === 'PENDING' || task.value.status === 'RUNNING') schedulePoll()
    else if (task.value.status === 'SUCCEEDED') {
      if (task.value.rowCount === 0 || !task.value.downloadUrl) notify('当前范围没有可导出的数据。')
      else {
        downloadExport(task.value.downloadUrl, `我的账单-${new Date().toISOString().slice(0, 10)}.csv`)
        notify(`已导出 ${task.value.rowCount} 条数据，文件 24 小时内有效。`)
      }
      reset()
    } else if (task.value.status === 'CANCELLED') {
      notify('导出已取消，未保留文件。'); reset()
    } else {
      notify(task.value.errorMessage ?? (task.value.status === 'EXPIRED' ? '导出已过期，请重新导出。' : '导出失败，请重试。'), 'error')
      attempt.reset()
    }
  } catch (cause) {
    if (!(cause instanceof globalThis.DOMException && cause.name === 'AbortError')) {
      if (!pollErrorShown) notify(normalizeRequestError(cause).message, 'error')
      pollErrorShown = true
      schedulePoll(3000)
    }
  }
}

function clearPoll(): void {
  if (timer) globalThis.clearTimeout(timer)
  timer = undefined
  polling?.abort()
  polling = undefined
}

function reset(): void {
  clearPoll()
  attempt.reset()
  pollErrorShown = false
  task.value = undefined
}

onBeforeUnmount(clearPoll)
</script>

<template>
  <li v-if="presentation === 'setting'">
    <button
      type="button"
      :aria-label="actionLabel"
      :aria-busy="working"
      @click="act"
    >
      <span>导出全部数据</span>
      <span class="disclosure-value">{{ settingValue }}</span>
      <X
        v-if="working"
        :size="18"
        aria-hidden="true"
      />
      <ChevronRight
        v-else
        :size="18"
        aria-hidden="true"
      />
    </button>
  </li>
  <button
    v-else
    type="button"
    class="data-export-icon"
    :class="{ 'is-working': working }"
    :aria-label="actionLabel"
    :title="actionLabel"
    :aria-busy="working"
    @click="act"
  >
    <X
      v-if="working"
      :size="20"
      aria-hidden="true"
    />
    <Download
      v-else
      :size="20"
      aria-hidden="true"
    />
  </button>
</template>
