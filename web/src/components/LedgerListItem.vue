<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

import type { LedgerItem } from '../api/ledgerEntries'
import { formatLedgerTime } from '../domain/ledgerFormatting'

const props = defineProps<{ item: LedgerItem, showType: boolean }>()
const emit = defineEmits<{ context: [item: LedgerItem], open: [item: LedgerItem] }>()
let longPress: ReturnType<typeof globalThis.setTimeout> | undefined
let longPressTriggered = false
let longPressReset: ReturnType<typeof globalThis.setTimeout> | undefined

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

function startLongPress(event: { isPrimary: boolean, button: number }): void {
  if (!event.isPrimary || event.button !== 0) return
  cancelLongPress()
  if (longPressReset) globalThis.clearTimeout(longPressReset)
  longPressReset = undefined
  longPressTriggered = false
  longPress = globalThis.setTimeout(() => {
    longPress = undefined
    longPressTriggered = true
    emit('context', props.item)
  }, 550)
}

function openContext(): void {
  cancelLongPress()
  emit('context', props.item)
}

function openItem(): void {
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

onBeforeUnmount(() => {
  cancelLongPress()
  if (longPressReset) globalThis.clearTimeout(longPressReset)
})
</script>

<template>
  <article
    class="ledger-list-item"
    role="button"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-label="`${item.entryType === 'EXPENSE' ? '支出' : item.entryType === 'INCOME' ? '收入' : '调整'} ${item.title}，按 Shift+F10 打开账目操作`"
    @contextmenu.prevent="openContext"
    @click="openItem"
    @keydown="onKeydown"
    @pointerdown="startLongPress"
    @pointerup="cancelLongPress"
    @pointercancel="cancelLongPress"
    @pointerleave="cancelLongPress"
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
  </article>
</template>
