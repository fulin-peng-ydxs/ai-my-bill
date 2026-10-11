<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed, provide, ref, watch } from 'vue'
import { unsavedChangeScope } from '../composables/unsavedChanges'
import { pageActionTarget } from '../composables/pageActionTarget'
import { reserveDrawerCandidateSpace } from '../composables/drawerCandidateSpace'

import { useDialogController } from '../composables/useDialogController'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'
import ScrollRegion from './ScrollRegion.vue'
import AppOverlayContent from './AppOverlayContent.vue'

const props = defineProps<{
  id: string
  open: boolean
  title: string
  description?: string
  busy?: boolean
  hideFooterOnKeyboard?: boolean
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
const isOpen = computed(() => props.open)
const candidateSpace = ref(false)
const actions = ref<globalThis.HTMLElement>()
// 抽屉动作拥有独立目标，不能传送到背后页面的保存区。
provide(pageActionTarget, actions)
provide(unsavedChangeScope, props.id)
provide(reserveDrawerCandidateSpace, () => { candidateSpace.value = true })
watch(isOpen, (open) => { if (open) candidateSpace.value = false })
const { keyboardOpen, visibleHeight, bottomInset } = useKeyboardViewport()
const { dialog, phase, handleCancel, handleClose, handlePointerDown, handlePointerUp, handlePointerCancel, handleBackdropClick } = useDialogController(isOpen, (value) => { if (!props.busy) emit('update:open', value) })
</script>

<template>
  <dialog
    :id="id"
    ref="dialog"
    :data-motion-phase="phase"
    :inert="phase === 'closing'"
    class="app-drawer"
    :class="{ 'candidate-space': candidateSpace, 'keyboard-footer-hidden': hideFooterOnKeyboard && keyboardOpen }"
    :style="visibleHeight ? { '--drawer-viewport-height': `${visibleHeight}px`, '--drawer-viewport-bottom': `${bottomInset}px` } : undefined"
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
      <section class="overlay-panel drawer-panel">
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
          <button
            type="button"
            class="icon-button"
            aria-label="关闭"
            :disabled="busy"
            @click="emit('update:open', false)"
          >
            <X
              :size="20"
              aria-hidden="true"
            />
          </button>
        </header>
        <ScrollRegion class="overlay-body">
          <slot />
        </ScrollRegion>
        <div
          ref="actions"
          class="drawer-form-actions"
        />
        <footer
          v-if="$slots.footer"
          class="overlay-actions"
        >
          <slot name="footer" />
        </footer>
      </section>
    </AppOverlayContent>
  </dialog>
</template>
