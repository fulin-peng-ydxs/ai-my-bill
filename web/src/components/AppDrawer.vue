<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed, provide, ref, watch } from 'vue'
import { reserveDrawerCandidateSpace } from '../composables/drawerCandidateSpace'

import { useDialogController } from '../composables/useDialogController'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'
import ScrollRegion from './ScrollRegion.vue'

const props = defineProps<{
  id: string
  open: boolean
  title: string
  description?: string
  busy?: boolean
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
const isOpen = computed(() => props.open)
const candidateSpace = ref(false)
provide(reserveDrawerCandidateSpace, () => { candidateSpace.value = true })
watch(isOpen, (open) => { if (open) candidateSpace.value = false })
const { visibleHeight, bottomInset } = useKeyboardViewport()
const { dialog, handleCancel, handleClose } = useDialogController(isOpen, (value) => { if (!props.busy) emit('update:open', value) })
</script>

<template>
  <dialog
    :id="id"
    ref="dialog"
    class="app-drawer"
    :class="{ 'candidate-space': candidateSpace }"
    :style="visibleHeight ? { '--drawer-viewport-height': `${visibleHeight}px`, '--drawer-viewport-bottom': `${bottomInset}px` } : undefined"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="description ? `${id}-description` : undefined"
    @cancel="handleCancel"
    @close="handleClose"
  >
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
      <footer
        v-if="$slots.footer"
        class="overlay-actions"
      >
        <slot name="footer" />
      </footer>
    </section>
  </dialog>
</template>
