<script setup lang="ts">
import { LogOut, Menu } from 'lucide-vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { useLogout } from '../composables/useLogout'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'
import { clearAccountMemory } from '../composables/accountMemory'
import { registerUnsavedChanges } from '../composables/unsavedChanges'
import { useSessionStore } from '../stores/session'
import { usePreferencesStore } from '../stores/preferences'
import AppDrawer from './AppDrawer.vue'
import AppStateBlock from './AppStateBlock.vue'
import BottomNavigation from './BottomNavigation.vue'

const route = useRoute()
const navigationOpen = ref(false)
const adminLinks = [
  { to: '/admin', label: '用户管理' },
  { to: '/admin/default-dictionaries', label: '默认字典' },
  { to: '/admin/overview', label: '运行概况' },
  { to: '/admin/audit-logs', label: '操作日志' },
]
watch(() => route.fullPath, () => { navigationOpen.value = false })

const sessionStore = useSessionStore()
const preferencesStore = usePreferencesStore()
const isAdmin = computed(() => sessionStore.session?.role === 'ADMIN')
const { keyboardOpen, visibleHeight } = useKeyboardViewport()
const { loggingOut, logoutError, logout } = useLogout()
const hasUnsavedPreferences = computed(() => Object.values(preferencesStore.fieldStates).includes('error'))
const unregisterPreferenceGuard = registerUnsavedChanges(
  hasUnsavedPreferences,
  () => preferencesStore.discardPending(),
)
onUnmounted(unregisterPreferenceGuard)

watch(() => sessionStore.session?.accountId, (accountId, previousAccountId) => {
  if (previousAccountId && previousAccountId !== accountId) {
    clearAccountMemory(previousAccountId)
    preferencesStore.clearMemory()
  }
  if (accountId && !isAdmin.value) void preferencesStore.initialize(accountId)
}, { immediate: true })
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'admin-shell': isAdmin, 'keyboard-open': keyboardOpen }"
    :style="keyboardOpen && !isAdmin && visibleHeight ? { '--app-viewport-height': `${visibleHeight}px` } : undefined"
  >
    <aside
      v-if="isAdmin"
      class="admin-sidebar"
      aria-label="管理导航"
    >
      <RouterLink
        class="shell-brand"
        to="/admin"
      >
        我的账单
      </RouterLink>
      <nav>
        <RouterLink
          v-for="link in adminLinks"
          :key="link.to"
          :to="link.to"
          :class="{ 'admin-link-current': route.path === link.to }"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </aside>
    <header
      v-if="isAdmin"
      class="shell-header"
      :class="{ 'admin-shell-header': isAdmin }"
    >
      <div class="admin-mobile-title">
        <button
          type="button"
          class="icon-button admin-navigation-trigger"
          aria-label="打开管理导航"
          aria-controls="admin-navigation"
          :aria-expanded="navigationOpen"
          @click="navigationOpen = true"
        >
          <Menu
            :size="20"
            aria-hidden="true"
          />
        </button>
        <span>系统管理</span>
      </div>
      <button
        v-if="isAdmin"
        type="button"
        class="header-action"
        aria-label="退出登录"
        :disabled="loggingOut"
        @click="logout"
      >
        <LogOut
          :size="18"
          aria-hidden="true"
        />
        <span>{{ loggingOut ? '正在退出…' : '退出' }}</span>
      </button>
    </header>
    <AppDrawer
      v-if="isAdmin"
      id="admin-navigation"
      v-model:open="navigationOpen"
      title="管理导航"
    >
      <nav
        class="admin-mobile-navigation"
        aria-label="移动端管理导航"
      >
        <RouterLink
          v-for="link in adminLinks"
          :key="link.to"
          :to="link.to"
          :class="{ 'admin-link-current': route.path === link.to }"
          @click="navigationOpen = false"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
    </AppDrawer>
    <main class="shell-content">
      <AppStateBlock
        v-if="logoutError"
        class="shell-error"
        kind="error"
        title="退出未完成"
        :message="logoutError"
        action-label="重试"
        @action="logout"
      />
      <slot />
    </main>
    <BottomNavigation v-if="!isAdmin" />
  </div>
</template>
