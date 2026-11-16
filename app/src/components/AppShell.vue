<script setup lang="ts">
import { useKeyboardViewport } from '../composables/useKeyboardViewport'
import BottomNavigation from './BottomNavigation.vue'
const { keyboardOpen, visibleHeight, topInset } = useKeyboardViewport()
</script>
<template>
  <div class="app-shell" :class="{ 'keyboard-open': keyboardOpen }"
    :style="keyboardOpen && visibleHeight ? { '--app-viewport-height': `${visibleHeight}px`, '--app-viewport-top': `${topInset}px` } : undefined">
    <main class="shell-content"><slot /></main>
    <BottomNavigation />
  </div>
</template>
