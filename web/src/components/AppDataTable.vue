<script setup lang="ts">
defineProps<{
  caption: string
}>()
</script>

<template>
  <div
    class="data-table-scroll"
    tabindex="0"
    :aria-label="`${caption}，可横向滚动`"
  >
    <table class="app-data-table">
      <caption class="sr-only">
        {{ caption }}
      </caption>
      <thead><slot name="head" /></thead>
      <tbody><slot /></tbody>
    </table>
  </div>
</template>
