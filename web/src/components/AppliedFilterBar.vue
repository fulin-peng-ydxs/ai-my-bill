<script setup lang="ts">
import { SlidersHorizontal, X } from 'lucide-vue-next'

defineProps<{
  summaries: readonly string[]
  label?: string
}>()

defineEmits<{
  open: []
  clear: []
}>()
</script>

<template>
  <section
    class="applied-filter-bar"
    :aria-label="label ?? '已应用筛选'"
  >
    <div class="filter-summary">
      <span v-if="summaries.length === 0">未应用高级筛选</span>
      <span
        v-for="(summary, index) in summaries"
        v-else
        :key="`${index}-${summary}`"
        class="filter-chip"
      >{{ summary }}</span>
    </div>
    <div class="filter-actions">
      <button
        v-if="summaries.length"
        type="button"
        class="icon-button"
        aria-label="清除全部筛选"
        @click="$emit('clear')"
      >
        <X
          :size="18"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="secondary-button"
        @click="$emit('open')"
      >
        <SlidersHorizontal
          :size="18"
          aria-hidden="true"
        />筛选
      </button>
    </div>
  </section>
</template>
