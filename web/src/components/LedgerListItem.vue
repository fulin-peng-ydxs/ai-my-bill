<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

import type { LedgerItem } from '../api/ledgerEntries'
import { formatLedgerTime } from '../domain/ledgerFormatting'

const props = defineProps<{ item: LedgerItem, showType: boolean }>()
const emit = defineEmits<{ context: [item: LedgerItem] }>()
let longPress: ReturnType<typeof globalThis.setTimeout> | undefined

function cancelLongPress(): void {
  if (longPress) globalThis.clearTimeout(longPress)
  longPress = undefined
}

function startLongPress(event: { isPrimary: boolean, button: number }): void {
  if (!event.isPrimary || event.button !== 0) return
  cancelLongPress()
  longPress = globalThis.setTimeout(() => {
    longPress = undefined
    emit('context', props.item)
  }, 550)
}

function openContext(): void {
  cancelLongPress()
  emit('context', props.item)
}

function onKeydown(event: unknown): void {
  const keyboardEvent = event as { shiftKey: boolean, key: string, preventDefault: () => void }
  if (keyboardEvent.shiftKey && keyboardEvent.key === 'F10') {
    keyboardEvent.preventDefault()
    emit('context', props.item)
  }
}

onBeforeUnmount(cancelLongPress)
</script>

<template>
  <article
    class="ledger-list-item"
    tabindex="0"
    aria-haspopup="dialog"
    :aria-label="`${item.entryType === 'EXPENSE' ? '支出' : '收入'} ${item.title}，按 Shift+F10 打开账目操作`"
    @contextmenu.prevent="openContext"
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
