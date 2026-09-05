<script setup lang="ts">
import AppStateBlock from '../components/AppStateBlock.vue'
import PwaInstallPrompt from '../components/PwaInstallPrompt.vue'
import ThemeModeControl from '../components/ThemeModeControl.vue'
import { useLogout } from '../composables/useLogout'
import { useSessionStore } from '../stores/session'

const sessionStore = useSessionStore()
const { loggingOut, logoutError, logout } = useLogout()
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
      aria-labelledby="appearance-title"
    >
      <div class="section-heading">
        <div>
          <h2 id="appearance-title">
            外观
          </h2>
          <p>主题选择会立即生效，并用于下次首屏显示。</p>
        </div>
      </div>
      <ThemeModeControl />
    </section>

    <section
      class="settings-section"
      aria-labelledby="pwa-title"
    >
      <div class="section-heading">
        <div>
          <h2 id="pwa-title">
            安装到桌面
          </h2>
          <p>安装能力不可用时，网页模式仍保留完整功能。</p>
        </div>
      </div>
      <PwaInstallPrompt />
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
  </article>
</template>
