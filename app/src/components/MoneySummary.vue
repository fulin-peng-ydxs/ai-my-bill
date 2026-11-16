<script setup lang="ts">
import { formatCny } from '../domain/money'
import MoneyValue from './MoneyValue.vue'

export interface MoneySummaryItem {
  key: string
  label: string
  amount: string
  tone: 'income' | 'expense' | 'neutral'
  sign: '+' | '-' | ''
}

defineProps<{
  items: readonly MoneySummaryItem[]
  label?: string
}>()
</script>

<template>
  <dl
    class="money-summary"
    :aria-label="label ?? '金额汇总'"
  >
    <div
      v-for="item in items"
      :key="item.key"
      class="money-summary-item"
      :class="`money-${item.tone}`"
    >
      <dt>{{ item.label }}</dt>
      <dd>
        <MoneyValue
          v-if="item.tone === 'neutral'"
          :amount="item.amount"
        />
        <template v-else>
          <span class="sr-only">{{ item.sign === '+' ? '正' : item.sign === '-' ? '负' : '' }}</span>{{ item.sign }}{{ formatCny(item.amount) }}
        </template>
      </dd>
    </div>
  </dl>
</template>
