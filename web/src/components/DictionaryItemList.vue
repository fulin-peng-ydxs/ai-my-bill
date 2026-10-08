<script setup lang="ts">
import { MoreHorizontal } from 'lucide-vue-next'

export interface DictionaryListItem {
  id: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
  parentName?: string | null
  referenced?: boolean
}

defineProps<{
  items: DictionaryListItem[]
  label: string
  historyHint?: boolean
}>()

const emit = defineEmits<{ select: [item: DictionaryListItem] }>()
</script>

<template>
  <ul
    class="dictionary-item-list"
    :aria-label="label"
  >
    <li
      v-for="item in items"
      :key="item.id"
      :data-status="item.status"
    >
      <div class="dictionary-item-copy">
        <strong>{{ item.name }}</strong>
        <span v-if="item.parentName">归属 {{ item.parentName }}</span>
        <span v-if="historyHint && item.referenced">已被历史记录引用</span>
      </div>
      <span
        class="status-badge"
        :data-status="item.status"
      >{{ item.status === 'ACTIVE' ? '启用' : '停用' }}</span>
      <button
        type="button"
        class="icon-button"
        :aria-label="`管理${item.name}`"
        @click="emit('select', item)"
      >
        <MoreHorizontal
          :size="20"
          aria-hidden="true"
        />
      </button>
    </li>
  </ul>
</template>
