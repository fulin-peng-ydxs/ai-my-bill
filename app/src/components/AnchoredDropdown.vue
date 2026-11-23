<script setup lang="ts">
import AppTransition from './AppTransition.vue'
import { inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { dropdownLayout } from '../domain/dropdownLayout'
import { reserveDrawerCandidateSpace } from '../composables/drawerCandidateSpace'

let active = true
const reserveSpace = inject(reserveDrawerCandidateSpace, undefined)
const props = defineProps<{ open: boolean, anchor?: globalThis.HTMLElement | null, id: string }>()
const emit = defineEmits<{ close: [restoreFocus?: boolean], interact: [] }>()
const panel = ref<globalThis.HTMLElement>()
const position = ref<Record<string, string>>({})
let panelObserver: globalThis.ResizeObserver | undefined
let frame: number | undefined
let field: globalThis.Element | null = null
let revealOnFrame = false
let revealing = false

async function place(reveal = false): Promise<void> {
  if (!props.anchor || !props.open || revealing) return
  const rect = props.anchor.getBoundingClientRect()
  const viewport = globalThis.window.visualViewport
  const viewportLeft = Math.max(0, (viewport?.offsetLeft ?? 0) - globalThis.window.scrollX)
  // DOMRect 已随文档滚动移动；iOS 键盘平移不能再次计入可见区域。
  const viewportTop = Math.max(0, (viewport?.offsetTop ?? 0) - globalThis.window.scrollY)
  const scrollBody = props.anchor.closest<globalThis.HTMLElement>('.overlay-body, [data-page-scroll]')
  const body = scrollBody?.getBoundingClientRect()
  const topEdge = Math.max(viewportTop, body?.top ?? viewportTop)
  const viewportWidth = viewport?.width ?? globalThis.window.innerWidth
  const leftEdge = Math.max(viewportLeft, body?.left ?? viewportLeft)
  const rightEdge = Math.min(viewportLeft + viewportWidth, body?.right ?? viewportLeft + viewportWidth)
  const width = Math.max(0, rightEdge - leftEdge)
  const height = viewport?.height ?? globalThis.window.innerHeight
  const bottomEdge = Math.min(viewportTop + height, body?.bottom ?? viewportTop + height)
  if (rect.bottom <= topEdge || rect.top >= bottomEdge) {
    // 软键盘缩小抽屉时，正在搜索的候选仍保留输入焦点，并把所属字段带回正文可见区。
    if (scrollBody && panel.value?.contains(globalThis.document.activeElement)) {
      const before = scrollBody.scrollTop
      scrollBody.scrollTop += rect.top - topEdge - 8
      if (scrollBody.scrollTop !== before) { schedulePlace(); return }
    }
    emit('close', false)
    return
  }
  const savebar = props.anchor.closest('form')?.querySelector('.entry-savebar')
  const pinned = savebar && ['sticky', 'fixed'].includes(globalThis.getComputedStyle(savebar).position)
  const actions = pinned ? savebar : props.anchor.closest('dialog')?.querySelector('.overlay-actions')
  const layout = dropdownLayout(rect, { left: leftEdge, top: topEdge, right: rightEdge,
    bottom: bottomEdge, width }, panel.value?.scrollHeight ?? 320,
  globalThis.window.matchMedia('(max-width: 735px)').matches, actions?.getBoundingClientRect(), scrollBody?.scrollTop)
  const parent = props.anchor.closest('.entry-combobox')
  const parentRect = parent?.getBoundingClientRect()
  const minimumHeight = layout.revealHeight
  const needsReveal = reveal && scrollBody && layout.revealScroll !== 0
  const panelTop = needsReveal && layout.direction === 'above' ? rect.top - minimumHeight - 4 : layout.top
  position.value = {
    left: `${layout.left - (parentRect?.left ?? 0) + (parent?.scrollLeft ?? 0)}px`,
    width: `${layout.width}px`, maxHeight: `${needsReveal ? minimumHeight : layout.maxHeight}px`,
    top: `${panelTop - (parentRect?.top ?? 0) + (parent?.scrollTop ?? 0)}px`,
    visibility: layout.maxHeight > 0 || needsReveal ? 'visible' : 'hidden',
  }
  if (needsReveal) {
    // 候选保留在正文内，其实际溢出提供滚动范围；只在展开/键盘变化时让出空间。
    revealing = true
    await nextTick()
    if (active && props.open && scrollBody.isConnected) {
      scrollBody.scrollTop += layout.revealScroll
    }
    revealing = false
    if (active && props.open) await place()
  }
}
function schedulePlace(): void {
  if (frame !== undefined) return
  frame = globalThis.window.requestAnimationFrame(() => {
    frame = undefined
    const reveal = revealOnFrame
    revealOnFrame = false
    void place(reveal)
  })
}
function scheduleReveal(): void { revealOnFrame = true; schedulePlace() }
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
  globalThis.window.addEventListener('resize', scheduleReveal)
  globalThis.window.addEventListener('scroll', schedulePlace, true)
  globalThis.window.visualViewport?.addEventListener('resize', scheduleReveal)
  globalThis.window.visualViewport?.addEventListener('scroll', schedulePlace)
  globalThis.document.addEventListener('pointerdown', outside, true)
  globalThis.document.addEventListener('keydown', keydown, true)
  globalThis.document.addEventListener('focusin', focusOutside, true)
  globalThis.document.addEventListener('visibilitychange', pageHidden)
  globalThis.window.addEventListener('pagehide', pageHide)
  if (panel.value && globalThis.ResizeObserver) {
    // 初次过渡及异步候选可能晚于首次定位；实际内容/正文高度改变后再让位一次。
    let observedSize = ''
    const scrollBody = props.anchor?.closest<globalThis.HTMLElement>('.overlay-body, [data-page-scroll]')
    panelObserver = new globalThis.ResizeObserver(() => {
      const size = `${panel.value?.scrollHeight}:${scrollBody?.clientHeight}`
      if (size !== observedSize) { observedSize = size; scheduleReveal() }
      else schedulePlace()
    })
    panelObserver.observe(panel.value)
    if (scrollBody) panelObserver.observe(scrollBody)
  }
}
function unlisten(): void {
  if (frame !== undefined) globalThis.window.cancelAnimationFrame(frame)
  frame = undefined
  revealOnFrame = false
  panelObserver?.disconnect()
  panelObserver = undefined
  globalThis.window.removeEventListener('resize', scheduleReveal)
  globalThis.window.removeEventListener('scroll', schedulePlace, true)
  globalThis.window.visualViewport?.removeEventListener('resize', scheduleReveal)
  globalThis.window.visualViewport?.removeEventListener('scroll', schedulePlace)
  globalThis.document.removeEventListener('pointerdown', outside, true)
  globalThis.document.removeEventListener('keydown', keydown, true)
  globalThis.document.removeEventListener('focusin', focusOutside, true)
  globalThis.document.removeEventListener('visibilitychange', pageHidden)
  globalThis.window.removeEventListener('pagehide', pageHide)
}
watch(() => props.open, async (open) => {
  if (open) { reserveSpace?.(); await nextTick(); if (!active || !props.open) return; await place(true); if (active && props.open) { unlisten(); listen() } }
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
  <AppTransition effect="candidate">
    <div
      v-if="open"
      :id="id"
      ref="panel"
      class="anchored-dropdown"
      :style="position"
      :inert="!open"
      @pointerdown="emit('interact')"
      @mousedown="preserveInputFocus"
    >
      <slot />
    </div>
  </AppTransition>
</template>
