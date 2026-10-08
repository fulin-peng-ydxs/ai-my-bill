<script setup lang="ts">
import type { Component } from 'vue'
import SectionTitle from './SectionTitle.vue'

defineProps<{
  title: string
  description?: string
  icon?: Component
}>()
</script>

<template>
  <section class="form-section">
    <header class="section-heading">
      <SectionTitle
        :title="title"
        :icon="icon"
      />
      <p v-if="description">
        {{ description }}
      </p>
    </header>
    <div class="form-section-fields">
      <slot />
    </div>
  </section>
</template>
