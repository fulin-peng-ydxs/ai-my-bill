<script setup lang="ts">
import { ChartNoAxesCombined, CircleUserRound, List, Plus } from 'lucide-vue-next'
import { reactive, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ledgerRouteQuery, parseLedgerRoute } from '../domain/ledgerQuery'

import { useSessionStore } from '../stores/session'
import { primaryNavigationPages } from '../app/pageRegistry'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const targets = reactive<Record<string, string>>({})
watch(() => session.session?.accountId, () => {
  for (const key of Object.keys(targets)) delete targets[key]
}, { flush: 'sync' })
watch(() => route.fullPath, () => {
  if (route.name === 'reports' || route.name === 'bill-details') targets[String(route.name)] = route.fullPath
  // 已返回报表，后续从底部进入明细是独立浏览，不再携带旧下钻返回入口。
  const ledgerTarget = targets['bill-details']
  if (route.name === 'reports' && ledgerTarget) {
    const parsed = parseLedgerRoute(router.resolve(ledgerTarget).query)
    if (parsed.drill) targets['bill-details'] = router.resolve({ path: '/ledger', query: ledgerRouteQuery(parsed.filters) }).fullPath
  }
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
