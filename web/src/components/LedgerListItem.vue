<script setup lang="ts">
import { onBeforeUnmount, onDeactivated } from 'vue'

import type { LedgerItem } from '../api/ledgerEntries'
import { formatLedgerTime } from '../domain/ledgerFormatting'
import { isLedgerContextSwipe } from '../domain/ledgerInteraction'

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
let longPressTriggered = false
let longPressReset: ReturnType<typeof globalThis.setTimeout> | undefined
let pointerStart: { x: number, y: number } | undefined

function cancelLongPress(): void {
  if (longPress) globalThis.clearTimeout(longPress)
  longPress = undefined
  if (longPressTriggered && !longPressReset) {
    // pointerup 后的合成 click 会先执行；若浏览器不派发 click，则下一任务自动解除抑制。
    longPressReset = globalThis.setTimeout(() => {
      longPressTriggered = false
      longPressReset = undefined
    })
  }
}

function startLongPress(event: unknown): void {
  const pointerEvent = event as LedgerPointerEvent
  if (props.busy) return
  if (!pointerEvent.isPrimary || pointerEvent.button !== 0) return
  pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
  cancelLongPress()
  if (longPressReset) globalThis.clearTimeout(longPressReset)
  longPressReset = undefined
  longPressTriggered = false
  pointerStart = { x: pointerEvent.clientX, y: pointerEvent.clientY }
  longPress = globalThis.setTimeout(() => {
    longPress = undefined
    longPressTriggered = true
    emit('context', props.item)
  }, 550)
}

function finishPointer(event: unknown): void {
  const pointerEvent = event as LedgerPointerEvent
  const target = pointerEvent.currentTarget
  if (target.hasPointerCapture(pointerEvent.pointerId)) target.releasePointerCapture(pointerEvent.pointerId)
  const start = pointerStart
  pointerStart = undefined
  if (start && !longPressTriggered
    && isLedgerContextSwipe(start.x, start.y, pointerEvent.clientX, pointerEvent.clientY)) {
    if (longPress) globalThis.clearTimeout(longPress)
    longPress = undefined
    longPressTriggered = true
    emit('context', props.item)
  }
  cancelLongPress()
}

function cancelPointer(): void {
  pointerStart = undefined
  cancelLongPress()
}

function openContext(): void {
  if (props.busy) return
  cancelLongPress()
  emit('context', props.item)
}

function openItem(): void {
  if (props.busy) return
  if (longPressTriggered) {
    if (longPressReset) globalThis.clearTimeout(longPressReset)
    longPressReset = undefined
    longPressTriggered = false
    return
  }
  emit('open', props.item)
}

function onKeydown(event: unknown): void {
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
  if (longPressReset) globalThis.clearTimeout(longPressReset)
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
        {{ formatLedgerTime(item.occurredAt) }} · {{ item.categoryName }} · {{ item.counterpartyName }} · {{ item.fundingChannelName }}
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
        {{ item.fullyAdjusted ? '已全额退款/报销' : `已调整 ¥${item.effectiveAdjustmentAmount} · 净支出 ¥${item.netExpenseAmount}` }}
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
    >{{ item.entryType === 'EXPENSE' ? '−' : '+' }}¥{{ item.amount }}</strong>
    <span
      v-if="busy"
      class="ledger-row-busy"
    >处理中…</span>
  </article>
</template>
