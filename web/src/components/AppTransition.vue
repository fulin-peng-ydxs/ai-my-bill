<script setup lang="ts">
import { activateEnteringElement, deactivateLeavingElement } from '../composables/motion'
withDefaults(defineProps<{ effect?: 'fade' | 'candidate' | 'toast', appear?: boolean }>(), {
  effect: 'fade', appear: false,
})
</script>

<template>
  <Transition
    :name="`motion-${effect}`"
    :appear="appear"
    @before-enter="activateEnteringElement"
    @before-leave="deactivateLeavingElement"
  >
    <slot />
  </Transition>
</template>
