<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import { primaryNavigationPages } from './app/pageRegistry'

const route = useRoute()
const isUserPage = computed(() => route.meta.role === 'user')
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink
        v-if="isUserPage"
        class="brand"
        to="/entry"
      >
        我的账单
      </RouterLink>
      <span
        v-else
        class="brand brand-static"
      >我的账单</span>
      <span class="phase-badge">T3 认证基线</span>
    </header>
    <main class="app-content">
      <RouterView />
    </main>
    <nav
      v-if="isUserPage"
      class="app-navigation"
      aria-label="基线页面导航"
    >
      <RouterLink
        v-for="page in primaryNavigationPages"
        :key="page.pageKey"
        :to="page.path"
      >
        {{ page.title }}
      </RouterLink>
    </nav>
  </div>
</template>
