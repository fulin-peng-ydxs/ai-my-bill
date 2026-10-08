<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { dropdownLayout } from '../domain/dropdownLayout'

let active = true
const props = defineProps<{ open: boolean, anchor?: globalThis.HTMLElement | null, id: string }>()
const emit = defineEmits<{ close: [restoreFocus?: boolean], interact: [] }>()
const panel = ref<globalThis.HTMLElement>()
const target = computed(() => props.anchor?.closest('dialog') ?? 'body')
const inline = computed(() => Boolean(props.anchor && !props.anchor.closest('dialog')))
const position = ref<Record<string, string>>({})
let panelObserver: globalThis.ResizeObserver | undefined
let frame: number | undefined
let field: globalThis.Element | null = null

function place(): void {
  if (!props.anchor || !props.open) return
  const rect = props.anchor.getBoundingClientRect()
  const viewport = globalThis.window.visualViewport
  const leftEdge = viewport?.offsetLeft ?? 0
  const topEdge = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? globalThis.window.innerWidth
  const height = viewport?.height ?? globalThis.window.innerHeight
  if (rect.bottom <= topEdge || rect.top >= topEdge + height) {
    emit('close', false)
    return
  }
  const savebar = props.anchor.closest('form')?.querySelector('.entry-savebar')
  const sticky = savebar && globalThis.getComputedStyle(savebar).position === 'sticky'
  const layout = dropdownLayout(rect, { left: leftEdge, top: topEdge, right: leftEdge + width,
    bottom: topEdge + height, width }, panel.value?.scrollHeight ?? 320,
  globalThis.window.matchMedia('(max-width: 735px)').matches, sticky ? savebar.getBoundingClientRect() : undefined)
  const parent = props.anchor.closest('dialog') ?? props.anchor.closest('.entry-combobox')
  const parentRect = parent?.getBoundingClientRect()
  position.value = {
    left: `${layout.left - (parentRect?.left ?? 0) + (parent?.scrollLeft ?? 0)}px`,
    width: `${layout.width}px`, maxHeight: `${layout.maxHeight}px`,
    top: `${layout.top - (parentRect?.top ?? 0) + (parent?.scrollTop ?? 0)}px`,
    visibility: layout.maxHeight > 0 ? 'visible' : 'hidden',
  }
}
function schedulePlace(): void {
  if (frame !== undefined) return
  frame = globalThis.window.requestAnimationFrame(() => { frame = undefined; place() })
}
function outside(event: globalThis.PointerEvent): void {
  const node = event.target as globalThis.Node
  // iPhone 镜像切换光标时会向 HTML 发送 (-1,-1) 的哨兵事件，不代表页面外部点按。
  if ((node === globalThis.document.documentElement || node === globalThis.document.body)
    && event.clientX < 0 && event.clientY < 0) return
  if (!field?.contains(node) && !panel.value?.contains(node)) emit('close', false)
}
function focusFirst(): void { panel.value?.querySelector<globalThis.HTMLButtonElement>('button:not([disabled])')?.focus() }
defineExpose({ focusFirst })
function focusOutside(event: globalThis.FocusEvent): void {
  const node = event.target as globalThis.Node
  // iOS 在按钮切换为输入期间可能短暂把焦点移到 body；真正的外部点按仍由 pointerdown 关闭。
  if (node === globalThis.document.body || node === globalThis.document.documentElement) return
  if (!field?.contains(node) && !panel.value?.contains(node)) emit('close', false)
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
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close', true) }
}
function pageHidden(): void {
  if (globalThis.document.hidden) emit('close', false)
}
function pageHide(): void { emit('close', false) }
// 保留输入焦点，触摸选择不先触发键盘收缩、重排后再丢失 click。
function preserveInputFocus(event: globalThis.MouseEvent | globalThis.PointerEvent): void {
  if ((event.target as globalThis.Element).closest('button')) event.preventDefault()
}
function listen(): void {
  globalThis.window.addEventListener('resize', schedulePlace)
  globalThis.window.addEventListener('scroll', schedulePlace, true)
  globalThis.window.visualViewport?.addEventListener('resize', schedulePlace)
  globalThis.window.visualViewport?.addEventListener('scroll', schedulePlace)
  globalThis.document.addEventListener('pointerdown', outside, true)
  globalThis.document.addEventListener('keydown', keydown, true)
  globalThis.document.addEventListener('focusin', focusOutside, true)
  globalThis.document.addEventListener('visibilitychange', pageHidden)
  globalThis.window.addEventListener('pagehide', pageHide)
  if (panel.value && globalThis.ResizeObserver) {
    panelObserver = new globalThis.ResizeObserver(schedulePlace)
    panelObserver.observe(panel.value)
  }
}
function unlisten(): void {
  if (frame !== undefined) globalThis.window.cancelAnimationFrame(frame)
  frame = undefined
  panelObserver?.disconnect()
  panelObserver = undefined
  globalThis.window.removeEventListener('resize', schedulePlace)
  globalThis.window.removeEventListener('scroll', schedulePlace, true)
  globalThis.window.visualViewport?.removeEventListener('resize', schedulePlace)
  globalThis.window.visualViewport?.removeEventListener('scroll', schedulePlace)
  globalThis.document.removeEventListener('pointerdown', outside, true)
  globalThis.document.removeEventListener('keydown', keydown, true)
  globalThis.document.removeEventListener('focusin', focusOutside, true)
  globalThis.document.removeEventListener('visibilitychange', pageHidden)
  globalThis.window.removeEventListener('pagehide', pageHide)
}
watch(() => props.open, async (open) => {
  if (open) { await nextTick(); if (!active || !props.open) return; place(); listen() }
  else unlisten()
}, { immediate: true })
watch(() => props.anchor, (anchor) => {
  field = anchor?.closest('.entry-combobox') ?? field
  if (props.open) schedulePlace()
}, { immediate: true })
onActivated(() => { active = true })
onDeactivated(() => { active = false; unlisten() })
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
      @pointerdown="emit('interact')"
      @mousedown="preserveInputFocus"
    >
      <slot />
    </div>
  </Teleport>
</template>
