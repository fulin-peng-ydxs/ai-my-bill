<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'

import { primaryNavigationPages } from './app/pageRegistry'
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink
        class="brand"
        to="/entry"
      >
        我的账单
      </RouterLink>
      <span class="phase-badge">T1 工程基线</span>
    </header>
    <main class="app-content">
      <RouterView />
    </main>
    <nav
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
