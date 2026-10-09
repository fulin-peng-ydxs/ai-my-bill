<script setup lang="ts">
defineProps<{ contentLabel: string }>()
</script>

<template>
  <article class="page-workspace">
    <div class="page-workspace-header">
      <slot name="header" />
    </div>
    <div
      class="page-scroll-region"
      data-page-scroll
      role="region"
      :aria-label="contentLabel"
      tabindex="0"
    >
      <slot />
    </div>
    <slot name="overlays" />
  </article>
</template>
