<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

import type { LedgerItem } from '../api/ledgerEntries'
import { formatLedgerTime } from '../domain/ledgerFormatting'

const props = defineProps<{ item: LedgerItem, showType: boolean }>()
const emit = defineEmits<{ context: [item: LedgerItem], edit: [item: LedgerItem] }>()
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

function openEdit(): void {
  if (longPressTriggered) {
    if (longPressReset) globalThis.clearTimeout(longPressReset)
    longPressReset = undefined
    longPressTriggered = false
    return
  }
  emit('edit', props.item)
}

function onKeydown(event: unknown): void {
  const keyboardEvent = event as { shiftKey: boolean, key: string, preventDefault: () => void }
  if (keyboardEvent.shiftKey && keyboardEvent.key === 'F10') {
    keyboardEvent.preventDefault()
    emit('context', props.item)
  } else if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
    keyboardEvent.preventDefault()
    emit('edit', props.item)
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
    :aria-label="`${item.entryType === 'EXPENSE' ? '支出' : '收入'} ${item.title}，按 Shift+F10 打开账目操作`"
    @contextmenu.prevent="openContext"
    @click="openEdit"
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
        >{{ item.entryType === 'EXPENSE' ? '支出' : '收入' }}</span>
        <strong>{{ item.title }}</strong>
      </div>
      <p class="ledger-item-meta">
        {{ formatLedgerTime(item.occurredAt) }} · {{ item.categoryName }} · {{ item.counterpartyName }} · {{ item.fundingChannelName }}
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
