<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'

import AppShell from './components/AppShell.vue'
import UnsavedChangesDialog from './components/UnsavedChangesDialog.vue'

const route = useRoute()
const isAnonymous = computed(() => route.meta.role === 'anonymous')
</script>

<template>
  <RouterView v-if="isAnonymous" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
  <UnsavedChangesDialog />
</template>
