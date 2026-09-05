<script setup lang="ts">
import { computed } from 'vue'

import { usePwaInstallStore } from '../pwa/install'
import AppStateBlock from './AppStateBlock.vue'

const install = usePwaInstallStore()

const state = computed(() => {
  switch (install.status) {
    case 'detecting':
      return { kind: 'loading' as const, title: '正在检查安装能力', message: '网页仍可正常使用。' }
    case 'available':
      return { kind: 'info' as const, title: '可安装到桌面', message: '安装后可从桌面直接打开，网页功能保持一致。', action: '安装应用' }
    case 'installing':
      return { kind: 'loading' as const, title: '正在完成安装', message: '请按浏览器提示确认。' }
    case 'declined':
      return { kind: 'info' as const, title: '本次没有安装', message: install.guidance }
    case 'installed':
      return { kind: 'success' as const, title: '已在独立窗口中运行', message: '可以继续使用全部网页功能。' }
    case 'error':
      return { kind: 'error' as const, title: '暂时无法调起安装', message: install.guidance }
    default:
      return { kind: 'info' as const, title: '继续使用网页', message: install.guidance }
  }
})
</script>

<template>
  <div
    class="install-prompt"
    :data-install-status="install.status"
  >
    <AppStateBlock
      :kind="state.kind"
      :title="state.title"
      :message="state.message"
      :action-label="state.action"
      @action="install.install"
    />
  </div>
</template>
