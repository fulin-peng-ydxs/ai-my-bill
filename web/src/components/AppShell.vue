<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { useSessionStore } from '../stores/session'
import AppStateBlock from './AppStateBlock.vue'
import BottomNavigation from './BottomNavigation.vue'

const sessionStore = useSessionStore()
const router = useRouter()
const isAdmin = computed(() => sessionStore.session?.role === 'ADMIN')
const logoutError = ref<string>()

async function logout(): Promise<void> {
  logoutError.value = undefined
  try {
    await sessionStore.logout()
    await router.replace('/login')
  } catch (error) {
    logoutError.value = error instanceof Error ? error.message : '退出未完成，请重试。'
  }
}
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
          系统管理
        </RouterLink>
      </nav>
    </aside>
    <header class="shell-header">
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
        @click="logout"
      >
        <LogOut
          :size="18"
          aria-hidden="true"
        />
        <span>退出</span>
      </button>
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
