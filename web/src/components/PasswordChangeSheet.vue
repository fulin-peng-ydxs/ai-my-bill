<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { normalizeRequestError } from '../api/errors'
import { validatePasswordChange } from '../auth/password'
import { useSessionStore } from '../stores/session'
import AppDrawer from './AppDrawer.vue'
import AppStateBlock from './AppStateBlock.vue'
import FormField from './FormField.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean], saved: [] }>()
const session = useSessionStore()
const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const errors = ref<Record<string, string>>({})
const feedback = ref('')
const busy = ref(false)

function reset(): void {
  Object.assign(form, { currentPassword: '', newPassword: '', confirmPassword: '' })
  errors.value = {}
  feedback.value = ''
}

watch(() => props.open, () => reset())

function close(open: boolean): void {
  if (!busy.value) emit('update:open', open)
}

async function submit(): Promise<void> {
  if (busy.value) return
  errors.value = validatePasswordChange(form)
  feedback.value = ''
  if (Object.keys(errors.value).length) return
  busy.value = true
  try {
    // 服务端轮换会话；凭据仅留在当前弹层内存，不进入草稿或持久化偏好。
    await session.changePassword(form.currentPassword, form.newPassword)
    reset()
    emit('update:open', false)
    emit('saved')
  } catch (cause) {
    const error = normalizeRequestError(cause)
    errors.value = Object.fromEntries(Object.entries(error.fieldErrors).map(([key, values]) => [key, values[0] ?? '请检查此项']))
    feedback.value = error.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppDrawer
    id="change-password"
    :open="open"
    title="修改密码"
    :busy="busy"
    description="修改后当前设备保持登录，其他设备需重新登录。"
    @update:open="close"
  >
    <form
      id="change-password-form"
      class="password-change-form"
      @submit.prevent="submit"
    >
      <FormField
        field-id="current-password"
        label="当前密码"
        :error="errors.currentPassword"
      >
        <template #default="{ describedBy }">
          <input
            id="current-password"
            v-model="form.currentPassword"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
            :aria-describedby="describedBy"
          >
        </template>
      </FormField>
      <FormField
        field-id="new-password"
        label="新密码"
        help="15–64 个字符，请勿使用常见密码。"
        :error="errors.newPassword"
      >
        <template #default="{ describedBy }">
          <input
            id="new-password"
            v-model="form.newPassword"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
            :aria-describedby="describedBy"
          >
        </template>
      </FormField>
      <FormField
        field-id="confirm-password"
        label="确认新密码"
        :error="errors.confirmPassword"
      >
        <template #default="{ describedBy }">
          <input
            id="confirm-password"
            v-model="form.confirmPassword"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
            :aria-describedby="describedBy"
          >
        </template>
      </FormField>
      <AppStateBlock
        v-if="feedback"
        kind="error"
        title="密码未更新"
        :message="feedback"
      />
    </form>
    <template #footer>
      <button
        type="button"
        class="secondary-button"
        :disabled="busy"
        @click="close(false)"
      >
        取消
      </button>
      <button
        type="submit"
        class="primary-button"
        form="change-password-form"
        :disabled="busy"
      >
        {{ busy ? '正在更新…' : '更新密码' }}
      </button>
    </template>
  </AppDrawer>
</template>
