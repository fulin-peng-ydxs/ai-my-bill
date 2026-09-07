<script setup lang="ts">
import { computed } from 'vue'

import type { LedgerEntryTypeFilter, LedgerItem, LedgerLifecycleFilter } from '../api/ledgerEntries'
import { formatLedgerDate } from '../domain/ledgerFormatting'
import LedgerListItem from './LedgerListItem.vue'

const props = defineProps<{
  items: LedgerItem[]
  type: LedgerEntryTypeFilter
  hasMore: boolean
  loadingMore: boolean
  lifecycle: LedgerLifecycleFilter
  busyItemId?: string
}>()
const emit = defineEmits<{ more: [], context: [item: LedgerItem], open: [item: LedgerItem] }>()

const groups = computed(() => {
  const byDate = new Map<string, LedgerItem[]>()
  for (const item of props.items) {
    const group = byDate.get(item.businessDate)
    if (group) group.push(item)
    else byDate.set(item.businessDate, [item])
  }
  return Array.from(byDate, ([date, items]) => ({ date, items }))
})

</script>

<template>
  <section
    class="incremental-ledger-list"
    :aria-label="lifecycle === 'ACTIVE' ? '有效收支列表' : '回收站列表'"
  >
    <section
      v-for="group in groups"
      :key="group.date"
      class="ledger-date-group"
    >
      <h2>{{ formatLedgerDate(group.date) }}</h2>
      <div class="ledger-date-items">
        <LedgerListItem
          v-for="item in group.items"
          :key="item.id"
          :item="item"
          :show-type="type === 'ALL' || type === 'ADJUSTMENT'"
          :busy="busyItemId === item.id"
          @context="emit('context', $event)"
          @open="emit('open', $event)"
        />
      </div>
    </section>
    <div class="ledger-progress">
      <span>已加载 {{ items.length }} 笔</span>
      <button
        v-if="hasMore"
        type="button"
        class="secondary-button"
        :disabled="loadingMore"
        @click="emit('more')"
      >
        {{ loadingMore ? '正在加载…' : '加载更多' }}
      </button>
      <span v-else>已显示全部结果</span>
    </div>
  </section>
</template>
