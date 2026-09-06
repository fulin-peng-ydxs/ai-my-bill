<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import AppShell from './components/AppShell.vue'
import AppStateBlock from './components/AppStateBlock.vue'
import UnsavedChangesDialog from './components/UnsavedChangesDialog.vue'
import { useSessionStore } from './stores/session'

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const isAnonymous = computed(() => route.meta.role === 'anonymous')
const hasPagePermission = computed(() => {
  const requiredRole = route.meta.role?.toUpperCase()
  return !requiredRole || requiredRole === 'ANONYMOUS' || requiredRole === sessionStore.session?.role
})
</script>

<template>
  <RouterView v-if="isAnonymous" />
  <AppShell v-else>
    <RouterView v-if="hasPagePermission" />
    <AppStateBlock
      v-else
      kind="permission"
      title="无权访问此页面"
      message="当前账号没有管理权限，未加载任何管理数据。"
      action-label="返回记一笔"
      @action="router.replace('/entry')"
    />
  </AppShell>
  <UnsavedChangesDialog />
</template>
