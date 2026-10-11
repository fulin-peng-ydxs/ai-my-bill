<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { LedgerEntryTypeFilter, LedgerItem, LedgerLifecycleFilter } from '../api/ledgerEntries'
import { formatLedgerDate } from '../domain/ledgerFormatting'
import LedgerListItem from './LedgerListItem.vue'
import { activateEnteringElement, deactivateLeavingElement } from '../composables/motion'

const props = defineProps<{
  items: LedgerItem[]
  type: LedgerEntryTypeFilter
  hasMore: boolean
  loadingMore: boolean
  lifecycle: LedgerLifecycleFilter
  busyItemId?: string
}>()
const animateMutation = ref(false)
watch(() => props.items, (items, previous) => {
  // 仅小列表的单条变更；翻页、批量筛选与增量加载不逐行播放。
  const previousIds = new Set(previous.map(item => item.id))
  const nextIds = new Set(items.map(item => item.id))
  const changed = [...previousIds].filter(id => !nextIds.has(id)).length + [...nextIds].filter(id => !previousIds.has(id)).length
  animateMutation.value = Math.max(items.length, previous.length) <= 40 && changed === 1 && !props.loadingMore
}, { flush: 'sync' })
watch(() => [props.type, props.lifecycle], () => { animateMutation.value = false }, { flush: 'sync' })

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
      <TransitionGroup
        tag="div"
        class="ledger-date-items content-list"
        name="motion-list"
        :css="animateMutation"
        :move-class="animateMutation ? 'motion-list-move' : 'motion-list-static'"
        @before-enter="activateEnteringElement"
        @before-leave="deactivateLeavingElement"
      >
        <LedgerListItem
          v-for="item in group.items"
          :key="item.id"
          :item="item"
          :show-type="type === 'ALL' || type === 'ADJUSTMENT'"
          :busy="busyItemId === item.id"
          @context="emit('context', $event)"
          @open="emit('open', $event)"
        />
      </TransitionGroup>
    </section>
    <div class="ledger-progress list-end-note">
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
