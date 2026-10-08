<script setup lang="ts">
import { ChevronDown, SlidersHorizontal, X } from 'lucide-vue-next'

export interface AppliedFilterSummary { key: string, label: string, value: string }

defineProps<{
  summaries: readonly AppliedFilterSummary[]
  label?: string
  clearable: boolean
}>()

defineEmits<{
  open: []
  clear: []
  edit: [key: string]
}>()
</script>

<template>
  <section
    class="applied-filter-bar"
    :aria-label="label ?? '已应用筛选'"
  >
    <div class="filter-context">
      <span class="filter-context-label">筛选条件</span>
      <div class="filter-summary">
        <span v-if="summaries.length === 0">暂无条件</span>
        <button
          v-for="summary in summaries"
          v-else
          :key="summary.key"
          type="button"
          class="filter-chip"
          :aria-label="`修改${summary.label}，当前${summary.value}`"
          :title="`${summary.label}：${summary.value}`"
          @click="$emit('edit', summary.key)"
        >
          <span class="filter-chip-content">
            <span><span class="filter-chip-label">{{ summary.label }}：</span><strong>{{ summary.value }}</strong></span>
            <ChevronDown
              :size="12"
              aria-hidden="true"
            />
          </span>
        </button>
      </div>
    </div>
    <div class="filter-actions">
      <button
        v-if="clearable"
        type="button"
        class="compact-action"
        aria-label="清除全部筛选"
        @click="$emit('clear')"
      >
        <X
          :size="16"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="compact-action"
        @click="$emit('open')"
      >
        <SlidersHorizontal
          :size="16"
          aria-hidden="true"
        />筛选
      </button>
    </div>
  </section>
</template>
