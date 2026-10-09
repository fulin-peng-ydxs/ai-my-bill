<script setup lang="ts">
import { computed } from 'vue'

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

defineEmits<{
  action: []
}>()
</script>

<template>
  <section
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
