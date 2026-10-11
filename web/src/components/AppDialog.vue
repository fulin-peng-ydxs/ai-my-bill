<script setup lang="ts">
import { computed } from 'vue'

import { useDialogController } from '../composables/useDialogController'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'
import ScrollRegion from './ScrollRegion.vue'
import AppOverlayContent from './AppOverlayContent.vue'

const props = withDefaults(defineProps<{
  id: string
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  confirmDisabled?: boolean
  danger?: boolean
  showCancel?: boolean
}>(), {
  description: undefined,
  confirmLabel: '确认',
  cancelLabel: '取消',
  busy: false,
  confirmDisabled: false,
  danger: false,
  showCancel: true,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()
const isOpen = computed(() => props.open)
const { visibleHeight, bottomInset, topInset } = useKeyboardViewport()
const { dialog, phase, handleCancel, handleClose, handlePointerDown, handlePointerUp, handlePointerCancel, handleBackdropClick } = useDialogController(isOpen, (value) => { if (!props.busy) emit('update:open', value) })
</script>

<template>
  <dialog
    :id="id"
    ref="dialog"
    :data-motion-phase="phase"
    :inert="phase === 'closing'"
    class="app-dialog"
    :style="visibleHeight ? { '--dialog-viewport-height': `${visibleHeight}px`, '--dialog-viewport-top': `${topInset}px`, '--dialog-viewport-bottom': `${bottomInset}px` } : undefined"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="description ? `${id}-description` : undefined"
    @cancel="handleCancel"
    @close="handleClose"
    @pointerdown="handlePointerDown"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
    @click="handleBackdropClick"
  >
    <AppOverlayContent :frozen="!open && phase !== 'closed'">
      <div class="overlay-panel dialog-panel">
        <header class="overlay-header">
          <div>
            <h2 :id="`${id}-title`">
              {{ title }}
            </h2>
            <p
              v-if="description"
              :id="`${id}-description`"
            >
              {{ description }}
            </p>
          </div>
        </header>
        <ScrollRegion
          v-if="$slots.default"
          class="overlay-body"
        >
          <slot />
        </ScrollRegion>
        <footer class="overlay-actions">
          <button
            v-if="showCancel"
            type="button"
            class="secondary-button"
            :disabled="busy"
            @click="emit('update:open', false)"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="primary-button"
            :class="{ 'danger-button': danger }"
            :disabled="busy || confirmDisabled"
            @click="emit('confirm')"
          >
            {{ busy ? '正在处理…' : confirmLabel }}
          </button>
        </footer>
      </div>
    </AppOverlayContent>
  </dialog>
</template>
