<script setup lang="ts">
import { MoreHorizontal, Plus, RefreshCw, Search } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'

import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  mutateAdminUser,
  type AdminUser,
  type AdminUserStatus,
  type TemporaryCredential,
} from '../../api/adminUsers'
import { normalizeRequestError } from '../../api/errors'
import AppDataTable from '../../components/AppDataTable.vue'
import AppDialog from '../../components/AppDialog.vue'
import AppDrawer from '../../components/AppDrawer.vue'
import AppStateBlock from '../../components/AppStateBlock.vue'
import AppToast from '../../components/AppToast.vue'
import FormField from '../../components/FormField.vue'
import { useLatestRequest } from '../../composables/useLatestRequest'
import { formatAdminTime } from '../../domain/adminPresentation'

type UserAction = 'disable' | 'restore' | 'reset-password' | 'deletion'

const queryDraft = ref('')
const appliedQuery = ref('')
const statusFilter = ref<AdminUserStatus | ''>('')
const selectedUser = ref<AdminUser>()
const userActionsOpen = ref(false)
const createOpen = ref(false)
const createUsername = ref('')
const createError = ref('')
const createBusy = ref(false)
const actionBusy = ref(false)
const pendingAction = ref<UserAction>()
const credential = ref<TemporaryCredential>()
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const { data, status, error, staleWarning, refreshing, execute } = useLatestRequest<Awaited<ReturnType<typeof listAdminUsers>>>()

const users = computed(() => data.value?.items ?? [])
const actionTitle = computed(() => {
  const labels: Record<UserAction, string> = {
    disable: '确认停用账号？',
    restore: '确认恢复账号？',
    'reset-password': '确认重置临时密码？',
    deletion: '永久注销这个账号？',
  }
  return pendingAction.value ? labels[pendingAction.value] : ''
})
const actionDescription = computed(() => pendingAction.value === 'deletion'
  ? '账号、在线个人数据、导出文件和全部会话会立即删除且无法恢复；匿名安全审计保留 180 天。请先确认用户已获得所需导出。'
  : pendingAction.value === 'reset-password'
    ? '全部旧会话会立即失效，新临时密码只展示这一次。'
    : pendingAction.value === 'disable'
      ? '用户会立即无法登录，全部旧会话也会失效。'
      : '账号恢复后可继续使用现有密码登录。')

function statusLabel(value: AdminUserStatus): string {
  return {
    ACTIVE: '正常',
    PENDING_FIRST_LOGIN: '待首次登录',
    DISABLED: '已停用',
    DELETION_PENDING: '注销处理中',
  }[value]
}

async function load(intent: 'replace' | 'refresh' = 'replace'): Promise<void> {
  await execute(
    (signal) => listAdminUsers(appliedQuery.value, statusFilter.value, signal),
    { intent: intent === 'refresh' ? 'silent' : 'replace', isEmpty: (page) => page.items.length === 0 },
  )
}

function search(): void {
  appliedQuery.value = queryDraft.value.trim()
  void load('replace')
}

function openUser(user: AdminUser): void {
  selectedUser.value = user
  userActionsOpen.value = true
}

function handleEmptyAction(): void {
  if (appliedQuery.value || statusFilter.value) {
    queryDraft.value = ''
    appliedQuery.value = ''
    statusFilter.value = ''
    void load()
    return
  }
  createOpen.value = true
}

function askAction(action: UserAction): void {
  userActionsOpen.value = false
  pendingAction.value = action
}

async function submitCreate(): Promise<void> {
  createError.value = ''
  const username = createUsername.value.trim()
  if (!/^[!-~]{3,64}$/.test(username)) {
    createError.value = '请输入 3-64 位可见 ASCII 字符。'
    return
  }
  createBusy.value = true
  try {
    credential.value = await createAdminUser(username)
    createOpen.value = false
    createUsername.value = ''
    await load('refresh')
  } catch (cause) {
    const requestError = normalizeRequestError(cause)
    createError.value = requestError.fieldErrors.username?.[0] ?? requestError.message
  } finally {
    createBusy.value = false
  }
}

async function confirmAction(): Promise<void> {
  if (!selectedUser.value || !pendingAction.value) return
  const action = pendingAction.value
  const target = selectedUser.value
  actionBusy.value = true
  try {
    if (action === 'deletion') {
      await deleteAdminUser(target)
      selectedUser.value = undefined
      toastMessage.value = '账号及在线个人数据已永久删除'
      toastKind.value = 'success'
      toastOpen.value = true
      pendingAction.value = undefined
      await load('refresh')
      return
    }
    const result = await mutateAdminUser(target, action)
    if ('temporaryPassword' in result) credential.value = result
    const updated = 'user' in result ? result.user : result
    selectedUser.value = updated
    toastMessage.value = '账号状态已更新'
    toastKind.value = 'success'
    toastOpen.value = true
    pendingAction.value = undefined
    await load('refresh')
  } catch (cause) {
    if (action === 'deletion') {
      // 响应可能在提交后丢失；刷新成功且目标已消失时按已完成收口。
      await load('refresh')
      if (!users.value.some((user) => user.accountId === target.accountId)) {
        selectedUser.value = undefined
        pendingAction.value = undefined
        toastMessage.value = '账号及在线个人数据已永久删除'
        toastKind.value = 'success'
        toastOpen.value = true
        return
      }
    }
    toastMessage.value = normalizeRequestError(cause).message
    toastKind.value = 'error'
    toastOpen.value = true
  } finally {
    actionBusy.value = false
  }
}

async function copyPassword(): Promise<void> {
  if (!credential.value) return
  try {
    await globalThis.navigator.clipboard.writeText(credential.value.temporaryPassword)
    toastMessage.value = '临时密码已复制'
    toastKind.value = 'success'
  } catch {
    toastMessage.value = '无法自动复制，请手动选择密码'
    toastKind.value = 'error'
  }
  toastOpen.value = true
}

onMounted(() => void load())
</script>

<template>
  <section class="admin-users-page">
    <header class="admin-page-heading">
      <div>
        <h1>用户管理</h1>
        <p>创建和维护普通用户账号。管理员无法查看用户的任何账目内容。</p>
      </div>
      <button
        type="button"
        class="primary-button"
        @click="createOpen = true"
      >
        <Plus
          :size="18"
          aria-hidden="true"
        /> 创建用户
      </button>
    </header>


    <form
      class="admin-toolbar"
      role="search"
      @submit.prevent="search"
    >
      <label class="admin-search">
        <span class="sr-only">搜索用户名</span>
        <Search
          :size="18"
          aria-hidden="true"
        />
        <input
          v-model="queryDraft"
          maxlength="64"
          placeholder="搜索用户名"
        >
      </label>
      <label>
        <span class="sr-only">账号状态</span>
        <select
          v-model="statusFilter"
          @change="load('replace')"
        >
          <option value="">全部状态</option>
          <option value="ACTIVE">正常</option>
          <option value="PENDING_FIRST_LOGIN">待首次登录</option>
          <option value="DISABLED">已停用</option>
          <option value="DELETION_PENDING">注销处理中</option>
        </select>
      </label>
      <button
        type="submit"
        class="secondary-button"
      >
        查询
      </button>
      <button
        type="button"
        class="icon-button"
        :disabled="refreshing"
        aria-label="刷新用户列表"
        @click="load('refresh')"
      >
        <RefreshCw
          :size="18"
          aria-hidden="true"
        />
      </button>
      <span class="admin-result-count">{{ data?.total ?? 0 }} 位用户</span>
    </form>

    <AppStateBlock
      v-if="staleWarning"
      kind="error"
      title="刷新未完成"
      :message="staleWarning.message"
      action-label="重试"
      @action="load('refresh')"
    />
    <AppStateBlock
      v-if="status === 'loading'"
      kind="loading"
      title="正在加载用户"
      message="正在读取账号状态，不会访问账目数据。"
    />
    <AppStateBlock
      v-else-if="status === 'error'"
      :kind="error?.kind === 'forbidden' ? 'permission' : 'error'"
      title="用户列表不可用"
      :message="error?.message"
      action-label="重试"
      @action="load()"
    />
    <AppStateBlock
      v-else-if="status === 'empty'"
      kind="empty"
      title="没有匹配的用户"
      :message="appliedQuery || statusFilter ? '调整搜索条件后重试。' : '创建第一位普通用户后，会在这里显示。'"
      :action-label="appliedQuery || statusFilter ? '清除条件' : '创建用户'"
      @action="handleEmptyAction"
    />

    <template v-else-if="status === 'ready'">
      <AppDataTable
        class="admin-users-table"
        caption="普通用户账号"
      >
        <template #head>
          <tr><th>用户名</th><th>状态</th><th>注册时间</th><th>最近活跃</th><th><span class="sr-only">操作</span></th></tr>
        </template>
        <tr
          v-for="user in users"
          :key="user.accountId"
        >
          <th scope="row">
            {{ user.username }}
          </th>
          <td>
            <span
              class="status-badge"
              :data-status="user.status"
            >{{ statusLabel(user.status) }}</span>
          </td>
          <td>{{ formatAdminTime(user.registeredAt) }}</td>
          <td>{{ formatAdminTime(user.lastActiveAt) }}</td>
          <td>
            <button
              type="button"
              class="text-action"
              @click="openUser(user)"
            >
              管理
            </button>
          </td>
        </tr>
      </AppDataTable>

      <ul
        class="admin-user-cards"
        aria-label="普通用户账号"
      >
        <li
          v-for="user in users"
          :key="user.accountId"
          :data-status="user.status"
        >
          <div>
            <strong>{{ user.username }}</strong><span
              class="status-badge"
              :data-status="user.status"
            >{{ statusLabel(user.status) }}</span>
          </div>
          <dl><dt>注册</dt><dd>{{ formatAdminTime(user.registeredAt) }}</dd><dt>活跃</dt><dd>{{ formatAdminTime(user.lastActiveAt) }}</dd></dl>
          <button
            type="button"
            class="icon-button"
            :aria-label="`管理 ${user.username}`"
            @click="openUser(user)"
          >
            <MoreHorizontal
              :size="20"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </template>

    <AppDialog
      id="create-user"
      v-model:open="createOpen"
      title="创建普通用户"
      description="系统会同时创建独立租户并复制当前默认字典。"
      confirm-label="创建并生成密码"
      :busy="createBusy"
      @confirm="submitCreate"
    >
      <FormField
        field-id="create-username"
        label="用户名"
        help="全局唯一，仅支持 3-64 位可见 ASCII 字符。"
        :error="createError"
      >
        <template #default="{ describedBy }">
          <input
            id="create-username"
            v-model="createUsername"
            autocomplete="off"
            maxlength="64"
            :aria-describedby="describedBy"
          >
        </template>
      </FormField>
    </AppDialog>

    <AppDialog
      id="temporary-password"
      :open="Boolean(credential)"
      title="临时密码已生成"
      description="请现在安全地交给用户。关闭后无法再次查看。"
      confirm-label="我已保存"
      :show-cancel="false"
      @update:open="credential = undefined"
      @confirm="credential = undefined"
    >
      <div
        v-if="credential"
        class="temporary-credential"
      >
        <span>{{ credential.user.username }}</span>
        <code>{{ credential.temporaryPassword }}</code>
        <span>有效期至 {{ formatAdminTime(credential.expiresAt) }}</span>
        <button
          type="button"
          class="secondary-button"
          @click="copyPassword"
        >
          复制临时密码
        </button>
      </div>
    </AppDialog>

    <AppDrawer
      id="user-actions"
      v-model:open="userActionsOpen"
      :title="selectedUser?.username ?? '用户操作'"
      description="所有高影响操作都会记录管理员审计。"
    >
      <dl
        v-if="selectedUser"
        class="user-detail-list"
      >
        <dt>状态</dt><dd>{{ statusLabel(selectedUser.status) }}</dd><dt>注册时间</dt><dd>{{ formatAdminTime(selectedUser.registeredAt) }}</dd><dt>最近活跃</dt><dd>{{ formatAdminTime(selectedUser.lastActiveAt) }}</dd>
      </dl>
      <div
        v-if="selectedUser"
        class="context-action-list"
      >
        <button
          v-if="selectedUser.status === 'ACTIVE' || selectedUser.status === 'PENDING_FIRST_LOGIN'"
          type="button"
          @click="askAction('disable')"
        >
          停用账号
        </button>
        <button
          v-if="selectedUser.status === 'DISABLED'"
          type="button"
          @click="askAction('restore')"
        >
          恢复账号
        </button>
        <button
          v-if="selectedUser.status !== 'DELETION_PENDING'"
          type="button"
          @click="askAction('reset-password')"
        >
          重置临时密码
        </button>
        <button
          v-if="selectedUser.status !== 'DELETION_PENDING'"
          type="button"
          class="danger-text"
          @click="askAction('deletion')"
        >
          永久注销账号
        </button>
      </div>
    </AppDrawer>

    <AppDialog
      id="confirm-user-action"
      :open="Boolean(pendingAction)"
      :title="actionTitle"
      :description="actionDescription"
      :danger="pendingAction === 'disable' || pendingAction === 'deletion'"
      :busy="actionBusy"
      @update:open="pendingAction = undefined"
      @confirm="confirmAction"
    />
    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
    />
  </section>
</template>
