<script setup lang="ts">
import { CheckCircle2, CircleAlert, X } from 'lucide-vue-next'

withDefaults(defineProps<{
  open: boolean
  message: string
  kind?: 'success' | 'error'
  actionLabel?: string
  actionDisabled?: boolean
}>(), { kind: 'success', actionLabel: undefined, actionDisabled: false })

defineEmits<{ 'update:open': [value: boolean], action: [] }>()
</script>

<template>
  <Transition name="toast">
    <div
      v-if="open"
      class="app-toast"
      :class="`app-toast-${kind}`"
      :role="kind === 'error' ? 'alert' : 'status'"
      :aria-live="kind === 'error' ? 'assertive' : 'polite'"
    >
      <CheckCircle2
        v-if="kind === 'success'"
        :size="20"
        aria-hidden="true"
      />
      <CircleAlert
        v-else
        :size="20"
        aria-hidden="true"
      />
      <span>{{ message }}</span>
      <button
        v-if="actionLabel"
        type="button"
        class="toast-action"
        :disabled="actionDisabled"
        @click="$emit('action')"
      >
        {{ actionLabel }}
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭提示"
        @click="$emit('update:open', false)"
      >
        <X
          :size="18"
          aria-hidden="true"
        />
      </button>
    </div>
  </Transition>
</template>
