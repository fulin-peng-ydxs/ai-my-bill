import { createMemoryHistory, createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { pageRegistry } from '../app/pageRegistry'
import PlaceholderView from '../views/PlaceholderView.vue'

const registeredRoutes: RouteRecordRaw[] = pageRegistry.map((page) => ({
  path: page.path,
  name: page.pageKey,
  component: PlaceholderView,
  props: { page },
  meta: {
    pageKey: page.pageKey,
    role: page.role,
    requiresAuthentication: page.role !== 'anonymous',
  },
}))

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/entry' },
  ...registeredRoutes,
]

export default createRouter({
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes,
})
