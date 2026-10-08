<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(defineProps<{ title: string, icon?: Component, as?: 'h2' | 'strong' }>(), { as: 'h2', icon: undefined })
</script>

<template>
  <component
    :is="as"
    class="section-title"
  >
    <span
      v-if="icon"
      class="section-title-symbol"
      aria-hidden="true"
    >
      <component
        :is="icon"
        :size="17"
        :stroke-width="1.7"
      />
    </span>
    <span>{{ title }}</span>
  </component>
</template>
