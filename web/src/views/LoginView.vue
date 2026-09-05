<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiClientError } from '../api/http'
import { isFormalPasswordLengthValid } from '../auth/password'
import AppDialog from '../components/AppDialog.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import FormField from '../components/FormField.vue'
import PwaInstallPrompt from '../components/PwaInstallPrompt.vue'
import ThemeModeControl from '../components/ThemeModeControl.vue'
import { postLoginPath } from '../router/navigation'
import { useSessionStore } from '../stores/session'

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()

const username = ref('')
const password = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const feedback = ref<string>()
const showHelp = ref(false)
const needsFirstPassword = computed(() => sessionStore.session?.passwordChangeRequired === true)
const visibleFeedback = computed(() => feedback.value
  ?? (sessionStore.status === 'error' ? sessionStore.errorMessage : undefined))

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.body?.message ?? error.message
  return error instanceof Error ? error.message : '暂时无法连接服务，请稍后重试。'
}

async function finishLogin(): Promise<void> {
  const session = sessionStore.session
  if (!session) return
  await router.replace(postLoginPath(session, route.query.redirect))
}

async function login(): Promise<void> {
  if (submitting.value) return
  feedback.value = undefined
  if (!username.value || !password.value) {
    feedback.value = '请输入用户名和密码。'
    return
  }
  submitting.value = true
  try {
    const session = await sessionStore.login(username.value, password.value)
    password.value = ''
    if (!session.passwordChangeRequired) await finishLogin()
  } catch (error) {
    feedback.value = errorMessage(error)
  } finally {
    submitting.value = false
  }
}

async function setFirstPassword(): Promise<void> {
  if (submitting.value) return
  feedback.value = undefined
  if (!isFormalPasswordLengthValid(newPassword.value)) {
    feedback.value = '正式密码必须为 15–64 个字符。'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    feedback.value = '两次输入的新密码不一致。'
    return
  }
  submitting.value = true
  try {
    await sessionStore.setFirstPassword(newPassword.value)
    newPassword.value = ''
    confirmPassword.value = ''
    await finishLogin()
  } catch (error) {
    feedback.value = errorMessage(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="auth-shell">
    <section
      class="auth-story"
      aria-label="产品说明"
    >
      <div class="auth-brand">
        我的账单
      </div>
      <div class="auth-thesis">
        <p class="eyebrow">
          收入有来源 · 支出有去处
        </p>
        <h1>每一笔，<br>都有来处。</h1>
        <p>快速记下日常收支，再从清晰的明细与报表里核对生活选择。</p>
      </div>
      <p class="auth-caption">
        可作为 PWA 添加到手机桌面
      </p>
    </section>

    <section class="auth-workspace">
      <div class="auth-card">
        <header class="auth-card-header">
          <div>
            <p class="eyebrow">
              安全会话
            </p>
            <h2>{{ needsFirstPassword ? '设置正式密码' : '欢迎回来' }}</h2>
          </div>
          <ThemeModeControl />
        </header>

        <form
          v-if="!needsFirstPassword"
          class="auth-form"
          data-testid="login-form"
          @submit.prevent="login"
        >
          <FormField
            v-slot="{ describedBy }"
            field-id="username"
            label="用户名"
          >
            <input
              id="username"
              v-model="username"
              name="username"
              autocomplete="username"
              maxlength="64"
              placeholder="输入管理员分配的用户名"
              :aria-describedby="describedBy"
              :disabled="submitting"
              required
            >
          </FormField>
          <FormField
            v-slot="{ describedBy }"
            field-id="password"
            label="密码"
            help="临时密码 24 小时有效，首次登录后需设置正式密码。"
          >
            <input
              id="password"
              v-model="password"
              name="password"
              type="password"
              autocomplete="current-password"
              maxlength="128"
              placeholder="首次登录可使用临时密码"
              :aria-describedby="describedBy"
              :disabled="submitting"
              required
            >
          </FormField>
          <AppStateBlock
            v-if="visibleFeedback"
            kind="error"
            title="登录未完成"
            :message="visibleFeedback"
          />
          <button
            class="primary-button"
            type="submit"
            :disabled="submitting"
            data-testid="login-submit"
          >
            {{ submitting ? '正在登录…' : '登录' }}
          </button>
          <button
            class="text-action auth-help-trigger"
            type="button"
            :aria-expanded="showHelp"
            @click="showHelp = !showHelp"
          >
            无法登录？
          </button>
        </form>

        <form
          v-else
          class="auth-form"
          data-testid="first-password-form"
          @submit.prevent="setFirstPassword"
        >
          <p class="form-intro">
            临时密码验证成功。请先设置正式密码，再进入系统。
          </p>
          <FormField
            v-slot="{ describedBy }"
            field-id="new-password"
            label="新密码"
            help="15–64 个字符，不得使用常见或已泄露密码。"
          >
            <input
              id="new-password"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              minlength="15"
              maxlength="128"
              :aria-describedby="describedBy"
              :disabled="submitting"
              required
            >
          </FormField>
          <FormField
            v-slot="{ describedBy }"
            field-id="confirm-password"
            label="确认新密码"
          >
            <input
              id="confirm-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              minlength="15"
              maxlength="128"
              :aria-describedby="describedBy"
              :disabled="submitting"
              required
            >
          </FormField>
          <AppStateBlock
            v-if="visibleFeedback"
            kind="error"
            title="密码设置未完成"
            :message="visibleFeedback"
          />
          <button
            class="primary-button"
            type="submit"
            :disabled="submitting"
          >
            {{ submitting ? '正在设置…' : '设置并进入系统' }}
          </button>
        </form>

        <section
          class="auth-install"
          aria-labelledby="install-title"
        >
          <h2 id="install-title">
            安装与离线
          </h2>
          <PwaInstallPrompt />
        </section>
      </div>
    </section>
    <AppDialog
      id="login-help"
      v-model:open="showHelp"
      title="无法登录？"
      description="请联系系统管理员重置密码；重置成功后，旧会话会立即失效。"
      confirm-label="知道了"
      :show-cancel="false"
      @confirm="showHelp = false"
    />
  </main>
</template>
