<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="form-section">
    <header class="section-heading">
      <h2>{{ title }}</h2>
      <p v-if="description">
        {{ description }}
      </p>
    </header>
    <div class="form-section-fields">
      <slot />
    </div>
  </section>
</template>
