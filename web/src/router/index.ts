import { createMemoryHistory, createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { pageRegistry } from '../app/pageRegistry'
import { useSessionStore } from '../stores/session'
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

const router = createRouter({
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const sessionStore = useSessionStore()
  await sessionStore.initialize()
  const session = sessionStore.session

  if (to.meta.requiresAuthentication) {
    if (!sessionStore.isAuthenticated || !session) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
    if (session.passwordChangeRequired) {
      return { path: '/login', query: { mode: 'first-password' } }
    }
    const requiredRole = to.meta.role?.toUpperCase()
    if (requiredRole && session.role !== requiredRole) {
      return session.role === 'ADMIN' ? '/admin' : '/entry'
    }
  }

  if (to.path === '/login' && sessionStore.isAuthenticated && session && !session.passwordChangeRequired) {
    return session.role === 'ADMIN' ? '/admin' : '/entry'
  }
  return true
})

export default router
