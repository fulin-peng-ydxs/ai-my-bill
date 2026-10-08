<script setup lang="ts">
import { ChartNoAxesCombined, CircleUserRound, List, Plus } from 'lucide-vue-next'
import { reactive, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { useSessionStore } from '../stores/session'
import { primaryNavigationPages } from '../app/pageRegistry'

const route = useRoute()
const session = useSessionStore()
const targets = reactive<Record<string, string>>({})
watch(() => session.session?.accountId, () => {
  for (const key of Object.keys(targets)) delete targets[key]
}, { flush: 'sync' })
watch(() => route.fullPath, () => {
  if (route.name === 'reports' || route.name === 'bill-details') targets[String(route.name)] = route.fullPath
}, { immediate: true })

const icons = {
  'ledger-entry': Plus,
  reports: ChartNoAxesCombined,
  'bill-details': List,
  'profile-settings': CircleUserRound,
}
</script>

<template>
  <nav
    class="bottom-navigation"
    aria-label="主导航"
  >
    <RouterLink
      v-for="page in primaryNavigationPages"
      :key="page.pageKey"
      :to="targets[page.pageKey] ?? page.path"
      :aria-label="page.title"
    >
      <component
        :is="icons[page.pageKey]"
        :size="22"
        :stroke-width="1.8"
        aria-hidden="true"
      />
      <span>{{ page.title === '收支报表' ? '报表' : page.title === '收支明细' ? '明细' : page.title }}</span>
    </RouterLink>
  </nav>
</template>
