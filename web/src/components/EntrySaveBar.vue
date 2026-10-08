<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ submitting: boolean, primaryLabel: string, continueVisible?: boolean, viewportPinned?: boolean }>(), {
  continueVisible: true,
  viewportPinned: false,
})
defineEmits<{ continue: [] }>()
const bar = ref<globalThis.HTMLDivElement>()
const height = ref(0)
let active = true
let observer: globalThis.ResizeObserver | undefined
function disconnect(): void { observer?.disconnect(); observer = undefined }
async function connect(): Promise<void> {
  if (!props.viewportPinned) return
  await nextTick()
  if (!active || !bar.value) return
  disconnect()
  // 固定操作栏离开文档流，按实际高度预留空间，兼容按钮换行与字号变化。
  const measure = () => { if (bar.value) height.value = bar.value.getBoundingClientRect().height }
  observer = new globalThis.ResizeObserver(measure)
  observer.observe(bar.value)
  measure()
}
onMounted(connect)
onActivated(() => { active = true; void connect() })
onDeactivated(() => { active = false; disconnect() })
onBeforeUnmount(() => { active = false; disconnect() })
</script>

<template>
  <div
    class="entry-savebar-slot"
    :class="{ 'entry-savebar-slot-pinned': viewportPinned }"
    :style="height ? { '--entry-savebar-height': `${height}px` } : undefined"
  >
    <div
      ref="bar"
      class="entry-savebar"
      :class="{ 'entry-savebar-single': !continueVisible, 'entry-savebar-pinned': viewportPinned }"
    >
      <button
        v-if="continueVisible"
        type="button"
        class="secondary-button"
        :disabled="submitting"
        @click="$emit('continue')"
      >
        {{ submitting ? '保存中…' : '保存并继续' }}
      </button>
      <button
        type="submit"
        class="primary-button"
        :disabled="submitting"
      >
        {{ submitting ? '保存中…' : primaryLabel }}
      </button>
    </div>
  </div>
</template>
