<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useContentMotion } from '../composables/useContentMotion'

const props = withDefaults(defineProps<{
  kind?: 'loading' | 'empty' | 'error' | 'permission' | 'success' | 'info'
  title: string
  message?: string
  actionLabel?: string
  actionDisabled?: boolean
}>(), {
  kind: 'info',
  message: undefined,
  actionLabel: undefined,
})

const role = computed(() => props.kind === 'error' || props.kind === 'permission' ? 'alert' : 'status')
const region = ref<globalThis.HTMLElement>()
const motion = useContentMotion()
function reveal(): void {
  // 加载和权限拒绝立即呈现，不延迟反馈或保留旧区域。
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
    :class="`state-block-${kind}`"
    :role="role"
    :aria-busy="kind === 'loading' ? 'true' : undefined"
  >
    <span
      v-if="kind === 'loading'"
      class="state-spinner"
      aria-hidden="true"
    />
    <div class="state-copy">
      <strong>{{ title }}</strong>
      <span v-if="message">{{ message }}</span>
    </div>
    <button
      v-if="actionLabel"
      type="button"
      class="text-action"
      :disabled="actionDisabled"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
  </section>
</template>
