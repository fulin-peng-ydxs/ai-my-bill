<script setup lang="ts">
import { useId } from 'vue'
import MoneyValue from './MoneyValue.vue'

defineProps<{ title: string, amount: string, description: string, tone: 'expense' | 'income', undoing: boolean }>()
defineEmits<{ undo: [] }>()
const titleId = useId()
</script>

<template>
  <section
    class="saved-entry-summary"
    :class="`saved-entry-${tone}`"
    :aria-labelledby="titleId"
  >
    <header>
      <div>
        <p class="eyebrow">
          刚刚保存
        </p>
        <h2 :id="titleId">
          {{ title }} · <MoneyValue
            :amount="amount"
            :tone="tone"
            :sign="tone === 'expense' ? '−' : '+'"
          />
        </h2>
        <p>{{ description }}</p>
      </div>
      <button
        type="button"
        class="text-action"
        :disabled="undoing"
        @click="$emit('undo')"
      >
        {{ undoing ? '撤销中…' : '撤销' }}
      </button>
    </header>
    <slot />
  </section>
</template>
