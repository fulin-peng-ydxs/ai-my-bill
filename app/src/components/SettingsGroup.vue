<script setup lang="ts">
import { useId } from 'vue'
import SectionTitle from './SectionTitle.vue'

defineProps<{ title: string }>()
const titleId = useId()
</script>

<template>
  <section
    class="settings-group"
    :aria-labelledby="titleId"
  >
    <SectionTitle
      :id="titleId"
      :title="title"
    />
    <div class="settings-section">
      <slot />
    </div>
  </section>
</template>
