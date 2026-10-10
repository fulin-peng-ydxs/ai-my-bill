<script setup lang="ts">
import { nextTick, provide, ref, watch } from 'vue'
import { pageActionTarget, pageNoticeTarget } from '../composables/pageActionTarget'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'
import { restorePageScrollBounds, revealFocusedPageControl } from '../composables/pageScroll'
import ScrollRegion from './ScrollRegion.vue'
defineProps<{ contentLabel: string }>()
const workspace = ref<globalThis.HTMLElement>()
const actions = ref<globalThis.HTMLElement>()
provide(pageActionTarget, actions)
provide(pageNoticeTarget, ref<globalThis.HTMLElement>())
const { keyboardOpen, visibleHeight, topInset } = useKeyboardViewport()
async function revealFocus(): Promise<void> {
  await nextTick()
  if (keyboardOpen.value) revealFocusedPageControl(workspace.value)
  else restorePageScrollBounds(workspace.value)
}
watch([keyboardOpen, visibleHeight, topInset], revealFocus, { flush: 'post' })
</script>

<template>
  <article
    ref="workspace"
    class="page-workspace"
    @focusin="revealFocus"
    @toggle.capture="revealFocus"
  >
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
    <div
      ref="actions"
      class="page-workspace-actions"
    />
    <slot name="overlays" />
  </article>
</template>
