<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ open: boolean, anchor?: globalThis.HTMLElement | null, id: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<globalThis.HTMLElement>()
const target = computed(() => props.anchor?.closest('dialog') ?? 'body')
const inline = computed(() => Boolean(props.anchor && !props.anchor.closest('dialog')))
const position = ref<Record<string, string>>({})
let panelObserver: globalThis.ResizeObserver | undefined

function place(): void {
  if (!props.anchor || !props.open) return
  const rect = props.anchor.getBoundingClientRect()
  const viewport = globalThis.window.visualViewport
  const leftEdge = viewport?.offsetLeft ?? 0
  const topEdge = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? globalThis.window.innerWidth
  const height = viewport?.height ?? globalThis.window.innerHeight
  const horizontalGap = 12
  const panelWidth = Math.min(rect.width, Math.max(0, width - horizontalGap * 2))
  const left = Math.max(leftEdge + horizontalGap, Math.min(rect.left, leftEdge + width - panelWidth - horizontalGap))
  const savebarTop = props.anchor.closest('form')?.querySelector('.entry-savebar')?.getBoundingClientRect().top
  const bottomEdge = Math.min(topEdge + height, savebarTop ?? Number.POSITIVE_INFINITY)
  const below = Math.max(0, bottomEdge - rect.bottom - horizontalGap - 4)
  const above = Math.max(0, rect.top - topEdge - horizontalGap - 4)
  const desiredHeight = Math.min(320, panel.value?.scrollHeight ?? 320)
  const opensAbove = below < Math.min(96, desiredHeight) && above > below
  const room = opensAbove ? above : below
  const panelHeight = Math.min(desiredHeight, room)
  const top = opensAbove ? rect.top - 4 - panelHeight : rect.bottom + 4
  const parentRect = (props.anchor.closest('dialog') ?? props.anchor.closest('.entry-combobox'))?.getBoundingClientRect()
  position.value = {
    left: `${left - (parentRect?.left ?? 0)}px`, width: `${panelWidth}px`, maxHeight: `${room}px`,
    top: `${top - (parentRect?.top ?? 0)}px`,
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
  if (panel.value && globalThis.ResizeObserver) {
    panelObserver = new globalThis.ResizeObserver(place)
    panelObserver.observe(panel.value)
  }
}
function unlisten(): void {
  panelObserver?.disconnect()
  panelObserver = undefined
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
  <Teleport
    :to="target"
    :disabled="inline"
  >
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
