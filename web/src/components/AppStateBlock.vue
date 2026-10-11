<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useContentMotion } from '../composables/useContentMotion'
import { useDelayedLoading } from '../composables/useDelayedLoading'

const props = withDefaults(defineProps<{
  kind?: 'loading' | 'empty' | 'error' | 'permission' | 'success' | 'info'
  title: string
  message?: string
  actionLabel?: string
  actionDisabled?: boolean
  immediate?: boolean
}>(), {
  kind: 'info',
  immediate: false,
  message: undefined,
  actionLabel: undefined,
})

const role = computed(() => props.kind === 'error' || props.kind === 'permission' ? 'alert' : 'status')
const loadingVisible = useDelayedLoading(() => props.kind === 'loading', () => props.immediate)
const loadingPending = computed(() => props.kind === 'loading' && !loadingVisible.value)
const region = ref<globalThis.HTMLElement>()
const motion = useContentMotion()
function reveal(): void {
  // 读取提示由延迟机制控制；错误、权限和保存反馈不等待动效。
  if (props.kind !== 'loading' && props.kind !== 'permission') void motion.play(region.value)
  else motion.cancel()
}
onMounted(reveal)
watch(() => props.kind, reveal, { flush: 'post' })

defineEmits<{
  action: []
}>()
</script>

<template>
  <section
    ref="region"
    class="state-block"
    :class="[`state-block-${kind}`, { 'state-block-pending': loadingPending }]"
    :role="role"
    :aria-busy="kind === 'loading' ? 'true' : undefined"
  >
    <span
      v-if="kind === 'loading'"
      class="state-spinner"
      :class="{ 'loading-placeholder': loadingPending }"
      aria-hidden="true"
    />
    <div
      class="state-copy"
      :class="{ 'loading-placeholder': loadingPending }"
      :aria-hidden="loadingPending || undefined"
    >
      <strong>{{ title }}</strong>
      <span v-if="message">{{ message }}</span>
    </div>
    <button
      v-if="actionLabel"
      type="button"
      class="text-action"
      :class="{ 'loading-placeholder': loadingPending }"
      :disabled="actionDisabled"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
  </section>
</template>
