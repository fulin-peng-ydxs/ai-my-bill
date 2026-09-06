<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'
import { computed, onUnmounted, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { useLogout } from '../composables/useLogout'
import { clearAccountMemory } from '../composables/accountMemory'
import { registerUnsavedChanges } from '../composables/unsavedChanges'
import { useSessionStore } from '../stores/session'
import { usePreferencesStore } from '../stores/preferences'
import AppStateBlock from './AppStateBlock.vue'
import BottomNavigation from './BottomNavigation.vue'

const sessionStore = useSessionStore()
const preferencesStore = usePreferencesStore()
const isAdmin = computed(() => sessionStore.session?.role === 'ADMIN')
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
    :class="{ 'admin-shell': isAdmin }"
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
        <RouterLink to="/admin">
          用户管理
        </RouterLink>
        <RouterLink to="/admin/default-dictionaries">
          默认字典
        </RouterLink>
      </nav>
    </aside>
    <header
      class="shell-header"
      :class="{ 'admin-shell-header': isAdmin }"
    >
      <RouterLink
        v-if="!isAdmin"
        class="shell-brand"
        to="/entry"
      >
        我的账单
      </RouterLink>
      <div
        v-else
        class="admin-mobile-title"
      >
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
      <nav
        v-if="isAdmin"
        class="admin-mobile-navigation"
        aria-label="移动端管理导航"
      >
        <RouterLink to="/admin">
          用户管理
        </RouterLink>
        <RouterLink to="/admin/default-dictionaries">
          默认字典
        </RouterLink>
      </nav>
    </header>
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
