<script setup lang="ts">
import { CheckCircle2, CircleAlert, X } from 'lucide-vue-next'
import { onActivated, onDeactivated, ref, watch } from 'vue'
import { usePageActivity } from '../composables/usePageActivity'
import { useToastAutoDismiss } from '../composables/useToastAutoDismiss'
import { dialogMessageTarget } from '../composables/useDialogController'

const props = withDefaults(defineProps<{
  open: boolean
  message: string
  kind?: 'success' | 'error'
  actionLabel?: string
  actionDisabled?: boolean
  notificationKey?: string
}>(), { kind: 'success', actionLabel: undefined, actionDisabled: false, notificationKey: undefined })

const emit = defineEmits<{ 'update:open': [value: boolean], action: [] }>()
const pageActive = usePageActivity()
const active = ref(true)
const hovered = ref(false)
const focused = ref(false)
useToastAutoDismiss(() => ({
  open: props.open, message: props.message, kind: props.kind,
  paused: hovered.value || focused.value || props.actionDisabled,
  active: active.value && pageActive.value, notificationKey: props.notificationKey,
}), () => emit('update:open', false))
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false; hovered.value = false; focused.value = false })
watch(() => props.open, (open) => { if (!open) { hovered.value = false; focused.value = false } })
function pointerEntered(event: globalThis.PointerEvent): void {
  // 触摸也会派发 pointerenter，不能把一次手机点按当成持续悬停。
  if (event.pointerType === 'mouse') hovered.value = true
}
function focusLeft(event: globalThis.FocusEvent): void {
  focused.value = Boolean(event.relatedTarget instanceof globalThis.Node
    && (event.currentTarget as globalThis.HTMLElement).contains(event.relatedTarget))
}
</script>

<template>
  <Teleport :to="dialogMessageTarget ?? 'body'">
    <Transition name="toast">
      <div
        v-if="open && active && pageActive"
        class="app-toast"
        :class="`app-toast-${kind}`"
        :role="kind === 'error' ? 'alert' : 'status'"
        :aria-live="kind === 'error' ? 'assertive' : 'polite'"
        @pointerenter="pointerEntered"
        @pointerleave="hovered = false"
        @focusin="focused = true"
        @focusout="focusLeft"
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
  </Teleport>
</template>
