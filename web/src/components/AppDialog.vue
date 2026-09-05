<script setup lang="ts">
import { computed } from 'vue'

import { useDialogController } from '../composables/useDialogController'

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
const { dialog, handleCancel, handleClose } = useDialogController(isOpen, (value) => emit('update:open', value))
</script>

<template>
  <dialog
    :id="id"
    ref="dialog"
    class="app-dialog"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="description ? `${id}-description` : undefined"
    @cancel="handleCancel"
    @close="handleClose"
  >
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
      <div class="overlay-body">
        <slot />
      </div>
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
  </dialog>
</template>
