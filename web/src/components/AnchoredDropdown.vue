<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ open: boolean, anchor?: globalThis.HTMLElement | null, id: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<globalThis.HTMLElement>()
const target = computed(() => props.anchor?.closest('dialog') ?? 'body')
const position = ref<Record<string, string>>({})

function place(): void {
  if (!props.anchor || !props.open) return
  const rect = props.anchor.getBoundingClientRect()
  const viewport = globalThis.window.visualViewport
  const leftEdge = viewport?.offsetLeft ?? 0
  const topEdge = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? globalThis.window.innerWidth
  const height = viewport?.height ?? globalThis.window.innerHeight
  const horizontalGap = 12
  const panelWidth = Math.min(Math.max(rect.width, 240), width - horizontalGap * 2)
  const left = Math.max(leftEdge + horizontalGap, Math.min(rect.left, leftEdge + width - panelWidth - horizontalGap))
  const below = topEdge + height - rect.bottom - 12
  const above = rect.top - topEdge - 12
  const opensAbove = below < 180 && above > below
  const room = Math.max(96, opensAbove ? above : below)
  position.value = {
    left: `${left}px`, width: `${panelWidth}px`, maxHeight: `${Math.min(320, room)}px`,
    top: opensAbove ? 'auto' : `${rect.bottom + 4}px`,
    bottom: opensAbove ? `${globalThis.window.innerHeight - rect.top + 4}px` : 'auto',
  }
}
function outside(event: globalThis.PointerEvent): void {
  const node = event.target as globalThis.Node
  if (!props.anchor?.contains(node) && !panel.value?.contains(node)) emit('close')
}
function focusFirst(): void { panel.value?.querySelector<globalThis.HTMLButtonElement>('button:not([disabled])')?.focus() }
defineExpose({ focusFirst })
function focusOutside(event: globalThis.FocusEvent): void {
  const node = event.target as globalThis.Node
  if (!props.anchor?.contains(node) && !panel.value?.contains(node)) emit('close')
}
function keydown(event: globalThis.KeyboardEvent): void {
  if (panel.value?.contains(event.target as globalThis.Node) && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    const buttons = [...panel.value.querySelectorAll<globalThis.HTMLButtonElement>('button:not([disabled])')]
    if (buttons.length) {
      event.preventDefault()
      const current = buttons.indexOf(globalThis.document.activeElement as globalThis.HTMLButtonElement)
      const step = event.key === 'ArrowDown' ? 1 : -1
      buttons[(current + step + buttons.length) % buttons.length]?.focus()
    }
  }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); props.anchor?.focus() }
}
function listen(): void {
  globalThis.window.addEventListener('resize', place)
  globalThis.window.addEventListener('scroll', place, true)
  globalThis.window.visualViewport?.addEventListener('resize', place)
  globalThis.window.visualViewport?.addEventListener('scroll', place)
  globalThis.document.addEventListener('pointerdown', outside, true)
  globalThis.document.addEventListener('keydown', keydown, true)
  globalThis.document.addEventListener('focusin', focusOutside, true)
}
function unlisten(): void {
  globalThis.window.removeEventListener('resize', place)
  globalThis.window.removeEventListener('scroll', place, true)
  globalThis.window.visualViewport?.removeEventListener('resize', place)
  globalThis.window.visualViewport?.removeEventListener('scroll', place)
  globalThis.document.removeEventListener('pointerdown', outside, true)
  globalThis.document.removeEventListener('keydown', keydown, true)
  globalThis.document.removeEventListener('focusin', focusOutside, true)
}
watch(() => props.open, async (open) => {
  if (open) { await nextTick(); place(); listen() }
  else unlisten()
}, { immediate: true })
onBeforeUnmount(unlisten)
</script>

<template>
  <Teleport :to="target">
    <div
      v-if="open"
      :id="id"
      ref="panel"
      class="anchored-dropdown"
      :style="position"
    >
      <slot />
    </div>
  </Teleport>
</template>
