<script setup lang="ts">
import { MoreHorizontal } from 'lucide-vue-next'
import ReorderList, { type ReorderMove } from './ReorderList.vue'

export interface DictionaryListItem {
  id: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
  parentName?: string | null
  parentId?: string | null
  referenced?: boolean
}

defineProps<{
  items: DictionaryListItem[]
  label: string
  historyHint?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ select: [item: DictionaryListItem], move: [move: ReorderMove] }>()
</script>

<template>
  <ReorderList
    class="dictionary-item-list content-list"
    :label="label"
    :items="items"
    :disabled="busy"
    :item-class="(item) => item.status === 'INACTIVE' ? 'dictionary-item-inactive' : ''"
    @move="emit('move', $event)"
  >
    <template #default="{ item }">
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
        :disabled="busy"
        @click="emit('select', item)"
      >
        <MoreHorizontal
          :size="20"
          aria-hidden="true"
        />
      </button>
    </template>
  </ReorderList>
</template>
