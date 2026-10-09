<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref } from 'vue'

defineOptions({ inheritAttrs: false })
const visible = ref(false)
const indicator = ref({ height: '24px', transform: 'translateY(0)' })
let timer: ReturnType<typeof globalThis.setTimeout> | undefined

function hide(): void {
  if (timer) globalThis.clearTimeout(timer)
  timer = undefined
  visible.value = false
}

/** 手机用不拦截手势的滚动位置提示，结束后快速退场；桌面保留原生滚动条。 */
function onScroll(event: unknown): void {
  const region = (event as { currentTarget: globalThis.HTMLElement }).currentTarget
  const { clientHeight, scrollHeight, scrollTop } = region
  hide()
  if (scrollHeight <= clientHeight) return
  const height = Math.min(clientHeight, Math.max(24, clientHeight * clientHeight / scrollHeight))
  const offset = Math.max(0, Math.min(1, scrollTop / (scrollHeight - clientHeight))) * (clientHeight - height)
  indicator.value = { height: `${height}px`, transform: `translateY(${offset}px)` }
  visible.value = true
  timer = globalThis.setTimeout(hide, 300)
}
onDeactivated(hide)
onBeforeUnmount(hide)
</script>

<template>
  <div class="scroll-region-frame">
    <div
      v-bind="$attrs"
      class="scroll-region-body"
      @scroll.passive="onScroll"
    >
      <slot />
    </div>
    <span
      class="scroll-position-indicator"
      :class="{ 'is-visible': visible }"
      :style="indicator"
      aria-hidden="true"
    />
  </div>
</template>
