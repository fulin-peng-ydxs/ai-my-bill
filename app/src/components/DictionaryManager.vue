<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppDrawer from './AppDrawer.vue'
import DictionaryIndexPanel from './DictionaryIndexPanel.vue'
import { dictionaryDetailTarget, type DictionaryOrigin } from '../domain/dictionaryNavigation'

defineProps<{ origin: DictionaryOrigin }>()
const open = defineModel<boolean>('open', { required: true })
const router = useRouter()
</script>

<template>
  <AppDrawer
    :id="`${origin}-dictionaries`"
    v-model:open="open"
    title="选项管理"
  >
    <DictionaryIndexPanel
      v-if="open"
      @select="router.push(dictionaryDetailTarget($event, origin))"
    />
  </AppDrawer>
</template>
