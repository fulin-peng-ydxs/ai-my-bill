<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppDrawer from '../components/AppDrawer.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import PwaInstallPrompt from '../components/PwaInstallPrompt.vue'
import SettingsDisclosureList, { type SettingsDisclosureItem } from '../components/SettingsDisclosureList.vue'
import ThemeModeControl from '../components/ThemeModeControl.vue'
import { useLogout } from '../composables/useLogout'
import { usePwaInstallStore } from '../pwa/install'
import { useSessionStore } from '../stores/session'
import { useThemeStore } from '../stores/theme'
import { themeModeLabel } from '../theme/theme'

const sessionStore = useSessionStore()
const router = useRouter()
const themeStore = useThemeStore()
const installStore = usePwaInstallStore()
const { loggingOut, logoutError, logout } = useLogout()
const activeSetting = ref<'appearance' | 'install'>()
const drawerOpen = computed({
  get: () => activeSetting.value !== undefined,
  set: (open: boolean) => { if (!open) activeSetting.value = undefined },
})
const settingItems = computed<SettingsDisclosureItem[]>(() => [
  { key: 'appearance', label: '外观', value: themeModeLabel(themeStore.mode) },
  { key: 'install', label: '安装到桌面', value: installStore.status === 'installed' ? '已安装' : '查看方式' },
])

function openSetting(key: string): void {
  if (key === 'appearance' || key === 'install') activeSetting.value = key
}
</script>

<template>
  <article
    class="settings-page"
    data-page-key="profile-settings"
  >
    <header class="page-heading">
      <div>
        <p class="eyebrow">
          个人设置
        </p>
        <h1>我的</h1>
        <p>{{ sessionStore.session?.username }}</p>
      </div>
    </header>

    <section
      class="settings-section"
      aria-labelledby="preferences-title"
    >
      <div class="section-heading">
        <div>
          <h2 id="preferences-title">
            偏好设置
          </h2>
          <p>查看当前值，选择后在抽屉中修改。</p>
        </div>
      </div>
      <SettingsDisclosureList
        label="偏好设置"
        :items="settingItems"
        @select="openSetting"
      />
    </section>

    <section
      class="settings-section"
      aria-labelledby="data-security-title"
    >
      <div class="section-heading">
        <div>
          <h2 id="data-security-title">
            数据与安全
          </h2>
          <p>管理当前账号的记账候选项。</p>
        </div>
      </div>
      <SettingsDisclosureList
        label="数据与安全"
        :items="[{ key: 'dictionaries', label: '管理个人字典', value: '8 类' }]"
        @select="router.push({ name: 'personal-dictionaries' })"
      />
    </section>

    <section
      class="settings-section account-section"
      aria-labelledby="account-title"
    >
      <div class="section-heading">
        <div>
          <h2 id="account-title">
            账号操作
          </h2>
          <p>退出会撤销当前服务端会话。</p>
        </div>
      </div>
      <AppStateBlock
        v-if="logoutError"
        kind="error"
        title="退出未完成"
        :message="logoutError"
        action-label="重试"
        @action="logout"
      />
      <button
        class="text-action logout-action"
        type="button"
        :disabled="loggingOut"
        @click="logout"
      >
        {{ loggingOut ? '正在退出…' : '退出登录' }}
      </button>
    </section>

    <AppDrawer
      id="profile-setting"
      v-model:open="drawerOpen"
      :title="activeSetting === 'appearance' ? '外观' : '安装到桌面'"
      :description="activeSetting === 'appearance'
        ? '主题选择会立即生效，并用于下次首屏显示。'
        : '安装能力不可用时，网页模式仍保留完整功能。'"
    >
      <div
        v-if="activeSetting === 'appearance'"
        class="drawer-setting-content"
      >
        <ThemeModeControl />
      </div>
      <PwaInstallPrompt v-else-if="activeSetting === 'install'" />
    </AppDrawer>
  </article>
</template>
