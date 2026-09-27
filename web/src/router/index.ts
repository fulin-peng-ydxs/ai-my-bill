import { createMemoryHistory, createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { pageRegistry } from '../app/pageRegistry'
import { requestDiscardChanges } from '../composables/unsavedChanges'
import { useSessionStore } from '../stores/session'
import LoginView from '../views/LoginView.vue'
import LedgerEntryPreferenceView from '../views/LedgerEntryPreferenceView.vue'
import LedgerView from '../views/LedgerView.vue'
import PlaceholderView from '../views/PlaceholderView.vue'
import ProfileView from '../views/ProfileView.vue'
import UserManagementView from '../views/admin/UserManagementView.vue'
import DefaultDictionaryManagementView from '../views/admin/DefaultDictionaryManagementView.vue'
import AdminAuditLogView from '../views/admin/AdminAuditLogView.vue'
import AdminOverviewView from '../views/admin/AdminOverviewView.vue'
import DictionaryDetailView from '../views/me/dictionaries/DictionaryDetailView.vue'
import DictionaryIndexView from '../views/me/dictionaries/DictionaryIndexView.vue'

const registeredRoutes: RouteRecordRaw[] = pageRegistry.map((page) => ({
  path: page.path,
  name: page.pageKey,
  component: page.pageKey === 'login'
    ? LoginView
    : page.pageKey === 'ledger-entry'
      ? LedgerEntryPreferenceView
    : page.pageKey === 'bill-details'
      ? LedgerView
    : page.pageKey === 'reports'
      ? () => import('../views/ReportView.vue')
    : page.pageKey === 'admin-console'
      ? UserManagementView
    : page.pageKey === 'admin-default-dictionaries'
      ? DefaultDictionaryManagementView
    : page.pageKey === 'admin-overview'
      ? AdminOverviewView
    : page.pageKey === 'admin-audit-logs'
      ? AdminAuditLogView
    : page.pageKey === 'profile-settings'
      ? ProfileView
    : page.pageKey === 'personal-dictionaries'
      ? DictionaryIndexView
    : page.pageKey === 'personal-dictionary-detail'
      ? DictionaryDetailView
      : PlaceholderView,
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
  if (!await requestDiscardChanges()) return false
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
      // 普通用户访问管理地址时保留目标 URL，由应用壳呈现明确的权限状态。
      return session.role === 'ADMIN' ? '/admin' : true
    }
  }

  if (to.path === '/login' && sessionStore.isAuthenticated && session && !session.passwordChangeRequired) {
    return session.role === 'ADMIN' ? '/admin' : '/entry'
  }
  return true
})

export default router
