<script setup lang="ts">
import { useRefreshOnReturn } from '../../composables/useRefreshOnReturn'
import { MoreHorizontal, RefreshCw, Search } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'

import {
  listAdminAuditLogs,
  type AdminAuditFilters,
  type AdminAuditLogItem,
  type AdminAuditPeriod,
  type AdminAuditResult,
} from '../../api/adminOperations'
import AppDataTable from '../../components/AppDataTable.vue'
import AppDrawer from '../../components/AppDrawer.vue'
import AppStateBlock from '../../components/AppStateBlock.vue'
import { useLatestRequest } from '../../composables/useLatestRequest'
import {
  adminActionLabel,
  adminObjectLabel,
  auditChanges,
  formatAdminTime,
} from '../../domain/adminPresentation'

const administratorDraft = ref('')
const actionDraft = ref('')
const objectDraft = ref('')
const resultDraft = ref<AdminAuditResult | ''>('')
const periodDraft = ref<AdminAuditPeriod>('ALL')
const applied = ref<AdminAuditFilters>({
  administrator: '', action: '', object: '', result: '', period: 'ALL', page: 0,
})
const selected = ref<AdminAuditLogItem>()
const detailOpen = ref(false)
const { data, status, error, staleWarning, refreshing, execute } = useLatestRequest<Awaited<ReturnType<typeof listAdminAuditLogs>>>()
const items = computed(() => data.value?.items ?? [])
const totalPages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 50)))
const hasAppliedFilters = computed(() => Boolean(
  applied.value.administrator
  || applied.value.action
  || applied.value.object
  || applied.value.result
  || applied.value.period !== 'ALL',
))

async function load(refresh = false): Promise<void> {
  const snapshot = { ...applied.value }
  await execute((signal) => listAdminAuditLogs(snapshot, signal), {
    intent: refresh ? 'silent' : 'replace', isEmpty: (page) => page.items.length === 0,
  })
}

function applyFilters(): void {
  applied.value = {
    administrator: administratorDraft.value.trim(),
    action: actionDraft.value,
    object: objectDraft.value.trim(),
    result: resultDraft.value,
    period: periodDraft.value,
    page: 0,
  }
  void load(data.value !== undefined)
}

function clearFilters(): void {
  administratorDraft.value = ''
  actionDraft.value = ''
  objectDraft.value = ''
  resultDraft.value = ''
  periodDraft.value = 'ALL'
  applyFilters()
}

function openDetail(item: AdminAuditLogItem): void {
  selected.value = item
  detailOpen.value = true
}

function changePage(delta: number): void {
  applied.value = { ...applied.value, page: applied.value.page + delta }
  void load()
}

function resultLabel(result: AdminAuditResult): string {
  return { SUCCEEDED: '成功', FAILED: '失败', DENIED: '已拒绝' }[result]
}

onMounted(() => void load())
useRefreshOnReturn(() => load(true))
</script>

<template>
  <section class="admin-audit-page">
    <header class="admin-page-heading">
      <div>
        <h1>操作日志</h1>
        <p>按管理员、动作、对象、结果和时间查询高影响管理操作；日志不可修改或删除。</p>
      </div>
      <button
        type="button"
        class="secondary-button admin-heading-action"
        :disabled="refreshing"
        @click="load(true)"
      >
        <RefreshCw
          :size="18"
          aria-hidden="true"
        />
        {{ refreshing ? '刷新中…' : '刷新日志' }}
      </button>
    </header>


    <form
      class="admin-audit-toolbar"
      role="search"
      @submit.prevent="applyFilters"
    >
      <label class="admin-search">
        <span class="sr-only">按管理员筛选</span>
        <Search
          :size="18"
          aria-hidden="true"
        />
        <input
          v-model="administratorDraft"
          maxlength="64"
          placeholder="管理员用户名"
        >
      </label>
      <label>
        <span class="sr-only">按动作筛选</span>
        <select v-model="actionDraft">
          <option value="">全部动作</option>
          <option value="CREATE_USER">创建用户</option>
          <option value="CHANGE_USER_STATUS">变更账号状态</option>
          <option value="RESET_USER_PASSWORD">重置用户密码</option>
          <option value="DELETE_USER_ACCOUNT">注销用户账号</option>
          <option value="CREATE_DEFAULT_DICTIONARY">新增默认字典</option>
          <option value="CHANGE_DEFAULT_DICTIONARY_STATUS">变更默认字典状态</option>
          <option value="MOVE_DEFAULT_DICTIONARY">调整默认字典排序</option>
        </select>
      </label>
      <label class="admin-search">
        <span class="sr-only">按对象筛选</span>
        <Search
          :size="18"
          aria-hidden="true"
        />
        <input
          v-model="objectDraft"
          maxlength="128"
          placeholder="对象类型或标识"
        >
      </label>
      <label>
        <span class="sr-only">按结果筛选</span>
        <select v-model="resultDraft">
          <option value="">全部结果</option>
          <option value="SUCCEEDED">成功</option>
          <option value="FAILED">失败</option>
          <option value="DENIED">已拒绝</option>
        </select>
      </label>
      <label>
        <span class="sr-only">按时间筛选</span>
        <select v-model="periodDraft">
          <option value="ALL">全部时间</option>
          <option value="TODAY">今天</option>
          <option value="LAST_7_DAYS">最近 7 天</option>
          <option value="LAST_30_DAYS">最近 30 天</option>
        </select>
      </label>
      <div class="admin-audit-actions">
        <button
          type="submit"
          class="primary-button"
        >
          应用筛选
        </button>
        <button
          type="button"
          class="text-action"
          @click="clearFilters"
        >
          清除
        </button>
      </div>
      <span class="admin-result-count">{{ data?.total ?? 0 }} 条日志</span>
    </form>

    <AppStateBlock
      v-if="staleWarning"
      kind="error"
      title="刷新未完成"
      :message="`${staleWarning.message} 当前仍显示上次成功结果。`"
      action-label="重试"
      @action="load(true)"
    />
    <AppStateBlock
      v-if="status === 'loading'"
      kind="loading"
      title="正在加载操作日志"
      message="只读取已清理的管理审计记录。"
    />
    <AppStateBlock
      v-else-if="status === 'error'"
      :kind="error?.kind === 'forbidden' ? 'permission' : 'error'"
      title="操作日志不可用"
      :message="error?.message"
      action-label="重试"
      @action="load()"
    />
    <AppStateBlock
      v-else-if="status === 'empty'"
      kind="empty"
      :title="hasAppliedFilters ? '没有匹配日志' : '还没有操作日志'"
      :message="hasAppliedFilters ? '调整管理员、动作、对象、结果或时间条件后重试。' : '完成创建用户、状态变更等高影响管理操作后，记录会出现在这里。'"
      :action-label="hasAppliedFilters ? '清除条件' : undefined"
      @action="clearFilters"
    />

    <template v-else-if="status === 'ready'">
      <AppDataTable
        class="admin-audit-table"
        caption="管理员操作日志"
      >
        <template #head>
          <tr><th>时间</th><th>管理员</th><th>动作</th><th>对象</th><th>结果</th><th><span class="sr-only">详情</span></th></tr>
        </template>
        <tr
          v-for="item in items"
          :key="item.id"
        >
          <td>{{ formatAdminTime(item.occurredAt) }}</td>
          <td>{{ item.administrator }}</td>
          <td>{{ adminActionLabel(item.action) }}</td>
          <td>{{ adminObjectLabel(item.objectType) }} · {{ item.objectId }}</td>
          <td>
            <span
              class="status-badge"
              :data-status="item.result"
            >{{ resultLabel(item.result) }}</span>
          </td>
          <td>
            <button
              type="button"
              class="text-action"
              @click="openDetail(item)"
            >
              查看
            </button>
          </td>
        </tr>
      </AppDataTable>

      <ul
        class="admin-audit-cards"
        aria-label="管理员操作日志"
      >
        <li
          v-for="item in items"
          :key="item.id"
          :data-status="item.result"
        >
          <div>
            <strong>{{ adminActionLabel(item.action) }}</strong>
            <span
              class="status-badge"
              :data-status="item.result"
            >{{ resultLabel(item.result) }}</span>
          </div>
          <p>{{ adminObjectLabel(item.objectType) }} · {{ item.objectId }}</p>
          <small>{{ item.administrator }} · {{ formatAdminTime(item.occurredAt) }}</small>
          <button
            type="button"
            class="icon-button"
            :aria-label="`查看 ${adminActionLabel(item.action)} 日志`"
            @click="openDetail(item)"
          >
            <MoreHorizontal
              :size="20"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>

      <nav
        v-if="totalPages > 1"
        class="dictionary-pagination"
        aria-label="操作日志分页"
      >
        <button
          type="button"
          class="secondary-button"
          :disabled="applied.page === 0"
          @click="changePage(-1)"
        >
          上一页
        </button>
        <span>第 {{ applied.page + 1 }} / {{ totalPages }} 页</span>
        <button
          type="button"
          class="secondary-button"
          :disabled="applied.page + 1 >= totalPages"
          @click="changePage(1)"
        >
          下一页
        </button>
      </nav>
    </template>

    <AppDrawer
      id="admin-audit-detail"
      v-model:open="detailOpen"
      title="操作日志详情"
      description="只读记录；敏感字段在写入前已经清理。"
    >
      <template v-if="selected">
        <dl class="user-detail-list">
          <dt>时间</dt><dd>{{ formatAdminTime(selected.occurredAt) }}</dd>
          <dt>管理员</dt><dd>{{ selected.administrator }}</dd>
          <dt>动作</dt><dd>{{ adminActionLabel(selected.action) }}</dd>
          <dt>对象</dt><dd>{{ adminObjectLabel(selected.objectType) }} · {{ selected.objectId }}</dd>
          <dt>结果</dt><dd>{{ resultLabel(selected.result) }}</dd>
        </dl>
        <div
          v-if="auditChanges(selected.safeSummary).length"
          class="audit-change-list"
        >
          <div
            v-for="change in auditChanges(selected.safeSummary)"
            :key="change.field"
          >
            <strong>{{ change.field }}</strong>
            <span>{{ change.before }} → {{ change.after }}</span>
          </div>
        </div>
        <AppStateBlock
          v-else
          kind="empty"
          title="没有可展示的字段变化"
          message="此动作只保留结果和对象标识，未记录密码或其他敏感内容。"
        />
      </template>
    </AppDrawer>
  </section>
</template>
