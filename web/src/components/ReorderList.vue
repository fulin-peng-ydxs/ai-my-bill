<script setup lang="ts" generic="T extends ReorderItem">
import { GripVertical } from 'lucide-vue-next'
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useId, watch } from 'vue'

export interface ReorderItem { id: string, name: string, parentId?: string | null }
export interface ReorderMove { id: string, targetId: string, direction: 'UP' | 'DOWN' }
defineOptions({ inheritAttrs: false })
const props = defineProps<{ items: T[], label: string, disabled?: boolean, itemClass?: (item: T) => string }>()
defineSlots<{ default(props: { item: T }): unknown }>()
const emit = defineEmits<{ move: [move: ReorderMove] }>()
const list = ref<globalThis.HTMLElement>()
const hintId = useId()
const dragged = ref('')
const dragOffset = ref(0)
const destination = ref<ReorderMove>()
let pointer: { id: number, source: ReorderItem, startY: number, scrollStart: number, y: number, x: number, handle: globalThis.HTMLElement } | undefined
let keyboardFocusId: string | undefined
let active = true
let scrollFrame = 0
let scrollContainer: globalThis.HTMLElement | undefined

function sameGroup(a: ReorderItem, b: ReorderItem): boolean {
  return (a.parentId ?? null) === (b.parentId ?? null)
}

function findScrollContainer(): globalThis.HTMLElement | undefined {
  let element = list.value?.parentElement
  while (element) {
    if (/(auto|scroll)/.test(globalThis.getComputedStyle(element).overflowY)) return element
    element = element.parentElement
  }
}

function updateDestination(): void {
  if (!pointer || !dragged.value || !list.value) return
  const bounds = list.value.getBoundingClientRect()
  if (pointer.x < bounds.left || pointer.x > bounds.right) { destination.value = undefined; return }
  const siblings = props.items.filter((item) => sameGroup(item, pointer!.source))
  const sourceIndex = siblings.findIndex((item) => item.id === pointer!.source.id)
  let candidate: ReorderMove | undefined
  for (const row of list.value.querySelectorAll<globalThis.HTMLElement>(':scope > li')) {
    const index = siblings.findIndex((item) => item.id === row.dataset.reorderId)
    if (index < 0 || index === sourceIndex) continue
    const rect = row.getBoundingClientRect()
    // 越过同行中线才移动；跨父分类的行永远不成为目标。
    if (index < sourceIndex && pointer.y < rect.top + rect.height / 2) {
      candidate = { id: pointer.source.id, targetId: siblings[index]!.id, direction: 'UP' }
      break
    }
    if (index > sourceIndex && pointer.y > rect.top + rect.height / 2) {
      candidate = { id: pointer.source.id, targetId: siblings[index]!.id, direction: 'DOWN' }
    }
  }
  dragOffset.value = pointer.y - pointer.startY + (scrollContainer?.scrollTop ?? 0) - pointer.scrollStart
  destination.value = candidate
}

function autoScroll(): void {
  if (!pointer || !dragged.value) return
  if (scrollContainer) {
    const rect = scrollContainer.getBoundingClientRect()
    const delta = pointer.y < rect.top + 48 ? -8 : pointer.y > rect.bottom - 48 ? 8 : 0
    if (delta) scrollContainer.scrollTop += delta
  }
  updateDestination()
  scrollFrame = globalThis.requestAnimationFrame(autoScroll)
}

function start(event: globalThis.PointerEvent, item: ReorderItem): void {
  if (props.disabled || !event.isPrimary || event.button !== 0) return
  cancel()
  const handle = event.currentTarget as globalThis.HTMLElement
  handle.setPointerCapture(event.pointerId)
  scrollContainer = findScrollContainer()
  pointer = { scrollStart: scrollContainer?.scrollTop ?? 0, id: event.pointerId, source: item, startY: event.clientY, y: event.clientY, x: event.clientX, handle }
}

function move(event: globalThis.PointerEvent): void {
  if (!pointer || event.pointerId !== pointer.id) return
  pointer.y = event.clientY
  pointer.x = event.clientX
  if (!dragged.value && Math.abs(pointer.y - pointer.startY) >= 6) {
    dragged.value = pointer.source.id
    scrollFrame = globalThis.requestAnimationFrame(autoScroll)
  }
  updateDestination()
}

function finish(event: globalThis.PointerEvent): void {
  if (!pointer || event.pointerId !== pointer.id) return
  move(event)
  const result = destination.value
  cancel()
  if (result && !props.disabled) emit('move', result)
}

function lostCapture(event: globalThis.PointerEvent): void {
  if (pointer?.id === event.pointerId) cancel()
}

function cancel(): void {
  globalThis.cancelAnimationFrame(scrollFrame)
  if (pointer?.handle.hasPointerCapture(pointer.id)) pointer.handle.releasePointerCapture(pointer.id)
  pointer = undefined
  scrollContainer = undefined
  dragOffset.value = 0
  dragged.value = ''
  destination.value = undefined
}

function keyboardMove(event: globalThis.KeyboardEvent, item: ReorderItem): void {
  if (event.key === 'Escape') { cancel(); return }
  if (props.disabled || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const siblings = props.items.filter((candidate) => sameGroup(candidate, item))
  const index = siblings.findIndex((candidate) => candidate.id === item.id)
  const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)]
  if (target) {
    keyboardFocusId = item.id
    emit('move', { id: item.id, targetId: target.id, direction: event.key === 'ArrowUp' ? 'UP' : 'DOWN' })
  }
}

watch(() => props.disabled, async (disabled) => {
  if (disabled) { cancel(); return }
  const id = keyboardFocusId
  keyboardFocusId = undefined
  await nextTick()
  // 禁用保存期间浏览器会移走焦点；仅为仍在本页的键盘排序恢复手柄。
  if (!id || !active || globalThis.document.documentElement.dataset.inputModality !== 'keyboard'
    || globalThis.document.activeElement !== globalThis.document.body || globalThis.document.querySelector('dialog[open]')) return
  const row = Array.from(list.value?.querySelectorAll<globalThis.HTMLElement>(':scope > li') ?? [])
    .find((element) => element.dataset.reorderId === id)
  row?.querySelector<globalThis.HTMLElement>('.reorder-handle')?.focus({ preventScroll: true })
})
watch(() => props.items, cancel)
onActivated(() => { active = true })
onDeactivated(() => { active = false; keyboardFocusId = undefined; cancel() })
function cancelWhenHidden(): void { if (globalThis.document.hidden) cancel() }
onMounted(() => globalThis.document.addEventListener('visibilitychange', cancelWhenHidden))
onBeforeUnmount(() => { cancel(); globalThis.document.removeEventListener('visibilitychange', cancelWhenHidden) })
</script>

<template>
  <p
    :id="hintId"
    class="sr-only"
  >
    拖动手柄调整同级顺序；键盘聚焦手柄后使用上下方向键，Esc 取消拖动。
  </p>
  <ul
    ref="list"
    v-bind="$attrs"
    class="reorder-list"
    :aria-label="label"
    :aria-busy="disabled || undefined"
  >
    <li
      v-for="item in items"
      :key="item.id"
      :data-reorder-id="item.id"
      :style="dragged === item.id ? { '--reorder-offset': `${dragOffset}px` } : undefined"
      :class="[itemClass?.(item), { 'reorder-dragging': dragged === item.id, 'reorder-before': destination?.targetId === item.id && destination.direction === 'UP', 'reorder-after': destination?.targetId === item.id && destination.direction === 'DOWN' }]"
    >
      <button
        type="button"
        class="icon-button reorder-handle"
        :aria-label="`拖动排序${item.name}`"
        :aria-describedby="hintId"
        :aria-keyshortcuts="'ArrowUp ArrowDown Escape'"
        :disabled="disabled"
        @pointerdown="start($event, item)"
        @pointermove="move"
        @pointerup="finish"
        @pointercancel="cancel"
        @lostpointercapture="lostCapture"
        @keydown="keyboardMove($event, item)"
        @click.prevent
      >
        <GripVertical
          :size="20"
          aria-hidden="true"
        />
      </button>
      <slot :item="item" />
    </li>
  </ul>
</template>
