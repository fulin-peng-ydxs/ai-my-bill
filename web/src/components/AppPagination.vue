<script setup lang="ts">
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  page: number
  totalPages: number
  label: string
  busy?: boolean
}>()
const emit = defineEmits<{ 'update:page': [page: number] }>()

function changePage(page: number): void {
  if (!props.busy && page >= 0 && page < props.totalPages) emit('update:page', page)
}
</script>

<template>
  <nav
    v-if="totalPages > 1"
    class="app-pagination"
    :aria-label="label"
    :aria-busy="busy || undefined"
  >
    <button
      type="button"
      class="pagination-button"
      :disabled="busy || page <= 0"
      @click="changePage(page - 1)"
    >
      <ChevronLeft
        :size="18"
        aria-hidden="true"
      />上一页
    </button>
    <span
      class="pagination-position"
      aria-live="polite"
    >第 {{ page + 1 }} / {{ totalPages }} 页</span>
    <button
      type="button"
      class="pagination-button"
      :disabled="busy || page + 1 >= totalPages"
      @click="changePage(page + 1)"
    >
      下一页<ChevronRight
        :size="18"
        aria-hidden="true"
      />
    </button>
  </nav>
</template>
