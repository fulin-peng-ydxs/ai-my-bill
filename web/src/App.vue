<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ContentMotion } from './composables/useContentMotion'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { dictionaryIndexTarget } from './domain/dictionaryNavigation'
import { pageCacheKey, pageCacheLimit } from './app/pageCache'
import CachedPageView from './components/CachedPageView.vue'
import AppShell from './components/AppShell.vue'
import AppStateBlock from './components/AppStateBlock.vue'
import UnsavedChangesDialog from './components/UnsavedChangesDialog.vue'
import { useSessionStore } from './stores/session'

const route = useRoute()
const pageMotion = ref<ContentMotion>('fade')
const router = useRouter()
watch(router.currentRoute, (to, from) => {
  const detail = 'personal-dictionary-detail'
  const returning = from.name === detail && to.fullPath === router.resolve(dictionaryIndexTarget(from.query.from)).fullPath
  pageMotion.value = to.name === detail && from.name !== detail ? 'forward' : returning ? 'back' : 'fade'
}, { flush: 'sync' })
const sessionStore = useSessionStore()
const isAnonymous = computed(() => route.meta.role === 'anonymous')
const isSessionInitializing = computed(() => sessionStore.status === 'unknown' || sessionStore.status === 'loading')
const hasPagePermission = computed(() => {
  const requiredRole = route.meta.role?.toUpperCase()
  return !requiredRole || requiredRole === 'ANONYMOUS' || requiredRole === sessionStore.session?.role
})
</script>

<template>
  <main
    v-if="isSessionInitializing"
    class="app-bootstrap-state"
  >
    <AppStateBlock
      kind="loading"
      title="正在确认会话"
      message="确认完成前不会加载账号页面或管理数据。"
    />
  </main>
  <RouterView v-else-if="isAnonymous" />
  <AppShell v-else>
    <RouterView v-slot="{ Component, route: viewRoute }">
      <KeepAlive
        :key="`${sessionStore.session?.accountId}:${sessionStore.session?.role}`"
        :max="pageCacheLimit"
      >
        <CachedPageView
          v-if="hasPagePermission && Component"
          :key="pageCacheKey(viewRoute)"
          :component="Component"
          :route="viewRoute"
          :motion="pageMotion"
        />
      </KeepAlive>
    </RouterView>
    <AppStateBlock
      v-if="!hasPagePermission"
      kind="permission"
      title="无权访问此页面"
      message="当前账号没有管理权限，未加载任何管理数据。"
      action-label="返回记一笔"
      @action="router.replace('/entry')"
    />
  </AppShell>
  <UnsavedChangesDialog />
</template>
