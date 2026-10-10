<script setup lang="ts">
import { computed } from 'vue'
import { DICTIONARY_PAGE_SIZE } from '../domain/dictionaries'
import AppPagination from './AppPagination.vue'

const props = defineProps<{ page: number, total: number, label: string, busy?: boolean }>()
defineEmits<{ 'update:page': [page: number] }>()
const totalPages = computed(() => Math.max(1, Math.ceil(props.total / DICTIONARY_PAGE_SIZE)))
</script>

<template>
  <footer class="dictionary-list-footer">
    <p
      v-if="totalPages === 1"
      class="list-end-note"
    >
      已显示全部 {{ total }} 项
    </p>
    <AppPagination
      :page="page"
      :total-pages="totalPages"
      :label="`${label}分页`"
      :busy="busy"
      @update:page="$emit('update:page', $event)"
    />
  </footer>
</template>
