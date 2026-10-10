<script setup lang="ts">
import { formatCny } from '../domain/money'
import { onBeforeUnmount, onDeactivated } from 'vue'

import type { LedgerItem } from '../api/ledgerEntries'
import { formatLedgerCounterparty, formatLedgerTime } from '../domain/ledgerFormatting'
import { hasLedgerPointerMoved } from '../domain/ledgerInteraction'

const props = defineProps<{ item: LedgerItem, showType: boolean, busy?: boolean }>()
const emit = defineEmits<{ context: [item: LedgerItem], open: [item: LedgerItem] }>()
type LedgerPointerEvent = {
  isPrimary: boolean
  button: number
  clientX: number
  clientY: number
  pointerId: number
  currentTarget: {
    setPointerCapture: (id: number) => void
    hasPointerCapture: (id: number) => boolean
    releasePointerCapture: (id: number) => void
  }
}
let longPress: ReturnType<typeof globalThis.setTimeout> | undefined
let suppressClick = false
let clickReset: ReturnType<typeof globalThis.setTimeout> | undefined
let pointerStart: { x: number, y: number } | undefined

function cancelLongPress(): void {
  if (longPress) globalThis.clearTimeout(longPress)
  longPress = undefined
}

function resetAfterClick(): void {
  if (!suppressClick || clickReset) return
  // pointerup 后的合成 click 先执行；没有 click 时也不能让下一次点击被误拦截。
  clickReset = globalThis.setTimeout(() => {
    suppressClick = false
    clickReset = undefined
  })
}

function startLongPress(event: unknown): void {
  const pointerEvent = event as LedgerPointerEvent
  if (props.busy || !pointerEvent.isPrimary || pointerEvent.button !== 0) return
  pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
  cancelLongPress()
  if (clickReset) globalThis.clearTimeout(clickReset)
  clickReset = undefined
  suppressClick = false
  pointerStart = { x: pointerEvent.clientX, y: pointerEvent.clientY }
  longPress = globalThis.setTimeout(() => {
    longPress = undefined
    suppressClick = true
    emit('context', props.item)
  }, 550)
}

function movePointer(event: unknown): void {
  if (!pointerStart) return
  const pointerEvent = event as LedgerPointerEvent
  if (!hasLedgerPointerMoved(pointerStart.x, pointerStart.y, pointerEvent.clientX, pointerEvent.clientY)) return
  // 滑动只用于浏览：立即取消长按，并拦截某些浏览器在拖动后生成的 click。
  suppressClick = true
  cancelLongPress()
}

function finishPointer(event: unknown): void {
  movePointer(event)
  const pointerEvent = event as LedgerPointerEvent
  const target = pointerEvent.currentTarget
  if (target.hasPointerCapture(pointerEvent.pointerId)) target.releasePointerCapture(pointerEvent.pointerId)
  pointerStart = undefined
  cancelLongPress()
  resetAfterClick()
}

function cancelPointer(): void {
  pointerStart = undefined
  cancelLongPress()
  resetAfterClick()
}

function openContext(): void {
  if (props.busy) return
  cancelLongPress()
  emit('context', props.item)
}

function openItem(): void {
  if (props.busy) return
  if (suppressClick) {
    if (clickReset) globalThis.clearTimeout(clickReset)
    clickReset = undefined
    suppressClick = false
    return
  }
  emit('open', props.item)
}

function onKeydown(event: unknown): void {
  if (props.busy) return
  const keyboardEvent = event as { shiftKey: boolean, key: string, preventDefault: () => void }
  if (keyboardEvent.shiftKey && keyboardEvent.key === 'F10') {
    keyboardEvent.preventDefault()
    emit('context', props.item)
  } else if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
    keyboardEvent.preventDefault()
    emit('open', props.item)
  }
}

function clearPress(): void {
  cancelLongPress()
  if (clickReset) globalThis.clearTimeout(clickReset)
  clickReset = undefined
  suppressClick = false
  pointerStart = undefined
}
onDeactivated(clearPress)
onBeforeUnmount(clearPress)
</script>

<template>
  <article
    class="ledger-list-item"
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-busy="busy || undefined"
    :aria-label="`${item.entryType === 'EXPENSE' ? '支出' : item.entryType === 'INCOME' ? '收入' : '调整'} ${item.title}，按 Shift+F10 打开账目操作`"
    @contextmenu.prevent="openContext"
    @click="openItem"
    @keydown="onKeydown"
    @pointerdown="startLongPress"
    @pointermove="movePointer"
    @pointerup="finishPointer"
    @pointercancel="cancelPointer"
    @pointerleave="cancelPointer"
  >
    <div class="ledger-item-main">
      <div class="ledger-item-title">
        <span
          v-if="showType"
          class="ledger-type-tag"
          :class="`ledger-type-${item.entryType.toLowerCase()}`"
        >{{ item.entryType === 'EXPENSE' ? '支出' : item.entryType === 'INCOME' ? '收入' : item.adjustmentType === 'REFUND' ? '退款' : '报销' }}</span>
        <strong>{{ item.title }}</strong>
      </div>
      <p class="ledger-item-meta">
        {{ formatLedgerTime(item.occurredAt) }} · {{ item.categoryName }} · {{ formatLedgerCounterparty(item) }} · {{ item.fundingChannelName }}
      </p>
      <p
        v-if="item.lifecycleStatus === 'TRASHED'"
        class="ledger-adjustment-state"
      >
        {{ item.remainingDays === 0 ? '今天到期' : `剩余 ${item.remainingDays} 天` }}<template v-if="item.linkedAdjustmentCount">
          · 将联动清理 {{ item.linkedAdjustmentCount }} 条调整
        </template>
      </p>
      <p
        v-if="item.entryType === 'EXPENSE' && item.effectiveAdjustmentAmount && item.effectiveAdjustmentAmount !== '0.00'"
        class="ledger-adjustment-state"
      >
        {{ item.fullyAdjusted ? '已全额退款/报销' : `已调整 ${formatCny(item.effectiveAdjustmentAmount)} · 净支出 ${formatCny(item.netExpenseAmount ?? '0')}` }}
      </p>
      <p
        v-if="item.note"
        class="ledger-item-note"
      >
        {{ item.note }}
      </p>
    </div>
    <strong
      class="ledger-item-amount"
      :class="`money-${item.entryType.toLowerCase()}`"
    >{{ item.entryType === 'EXPENSE' ? '−' : '+' }}{{ formatCny(item.amount) }}</strong>
    <span
      v-if="busy"
      class="ledger-row-busy"
    >处理中…</span>
  </article>
</template>
