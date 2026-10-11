<script setup lang="ts">
import { inject } from 'vue'
import { pageNoticeTarget } from '../composables/pageActionTarget'
import { useDelayedLoading } from '../composables/useDelayedLoading'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ pending: boolean, label?: string, immediate?: boolean, page?: boolean }>(), {
  label: '更新中…', immediate: false, page: false,
})
const target = inject(pageNoticeTarget, undefined)
const visible = useDelayedLoading(() => props.pending, () => props.immediate)
</script>

<template>
  <Teleport
    :to="target ?? 'body'"
    :disabled="!page || !target"
  >
    <span
      v-if="!page || visible"
      v-bind="$attrs"
      class="loading-hint"
      :class="{ 'loading-placeholder': !visible }"
      :aria-hidden="!visible || undefined"
      role="status"
    >{{ label }}</span>
  </Teleport>
</template>
