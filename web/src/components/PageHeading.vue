<script setup lang="ts">
import { inject } from 'vue'
import { pageNoticeTarget } from '../composables/pageActionTarget'

const notices = inject(pageNoticeTarget, undefined)
const hasNoticeTarget = Boolean(notices)
defineProps<{ title: string, subtitle?: string }>()
</script>

<template>
  <header class="page-heading">
    <div class="page-heading-copy">
      <div class="page-heading-title">
        <h1>{{ title }}</h1>
        <span
          v-if="hasNoticeTarget"
          ref="notices"
          class="page-heading-notices"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        />
      </div>
      <p v-if="subtitle">
        {{ subtitle }}
      </p>
    </div>
    <div
      v-if="$slots.default"
      class="page-heading-actions"
    >
      <slot />
    </div>
  </header>
</template>
