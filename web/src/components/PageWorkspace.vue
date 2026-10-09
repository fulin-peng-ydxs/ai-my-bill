<script setup lang="ts">
import ScrollRegion from './ScrollRegion.vue'
defineProps<{ contentLabel: string }>()
</script>

<template>
  <article class="page-workspace">
    <div
      v-if="$slots.header"
      class="page-workspace-header"
    >
      <slot name="header" />
    </div>
    <ScrollRegion
      class="page-scroll-region"
      data-page-scroll
      role="region"
      :aria-label="contentLabel"
      tabindex="0"
    >
      <slot />
    </ScrollRegion>
    <slot name="overlays" />
  </article>
</template>
