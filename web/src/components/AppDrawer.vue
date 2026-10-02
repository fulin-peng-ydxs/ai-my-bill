<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed } from 'vue'

import { useDialogController } from '../composables/useDialogController'

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
const { dialog, handleCancel, handleClose } = useDialogController(isOpen, (value) => { if (!props.busy) emit('update:open', value) })
</script>

<template>
  <dialog
    :id="id"
    ref="dialog"
    class="app-drawer"
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
      <div class="overlay-body">
        <slot />
      </div>
      <footer
        v-if="$slots.footer"
        class="overlay-actions"
      >
        <slot name="footer" />
      </footer>
    </section>
  </dialog>
</template>
