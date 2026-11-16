<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import type { ContentMotion } from './composables/useContentMotion'
import { dictionaryIndexTarget } from './domain/dictionaryNavigation'
import AppShell from './components/AppShell.vue'
import CachedPageView from './components/CachedPageView.vue'
import AppStateBlock from './components/AppStateBlock.vue'
import UnsavedChangesDialog from './components/UnsavedChangesDialog.vue'
import { pageCacheKey, pageCacheLimit } from './app/pageCache'
import { useBootstrapStore } from './stores/bootstrap'
const bootstrap = useBootstrapStore()
const router = useRouter()
const pageMotion = ref<ContentMotion>('fade')
watch(router.currentRoute, (to, from) => {
  const detail = 'personal-dictionary-detail'
  const returning = from.name === detail && to.fullPath === router.resolve(dictionaryIndexTarget(from.query.from)).fullPath
  pageMotion.value = to.name === detail && from.name !== detail ? 'forward' : returning ? 'back' : 'fade'
}, { flush: 'sync' })
void bootstrap.initialize()
</script>
<template>
  <div class="pwa-status-bar-surface" aria-hidden="true" />
  <main v-if="bootstrap.status !== 'ready'" class="app-bootstrap-state">
    <AppStateBlock v-if="bootstrap.status === 'loading'" kind="loading" title="正在打开账本" />
    <AppStateBlock v-else kind="error" title="账本暂不可用" :message="bootstrap.error?.message" :action-label="bootstrap.error?.retryable ? '重试' : undefined" @action="bootstrap.initialize()" />
  </main>
  <AppShell v-else>
    <RouterView v-slot="{ Component, route }"><KeepAlive :key="bootstrap.datasetId" :max="pageCacheLimit">
      <CachedPageView v-if="Component" :key="pageCacheKey(route)" :component="Component" :route="route" :motion="pageMotion" />
    </KeepAlive></RouterView>
  </AppShell>
  <UnsavedChangesDialog />
</template>
