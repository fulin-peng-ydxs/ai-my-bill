<script setup lang="ts">
import { Archive, Database, HeartPulse, RefreshCw, ShieldCheck, Users } from 'lucide-vue-next'
import { onMounted } from 'vue'

import { getAdminOverview } from '../../api/adminOperations'
import AppStateBlock from '../../components/AppStateBlock.vue'
import { useLatestRequest } from '../../composables/useLatestRequest'
import { formatAdminBytes, formatAdminTime } from '../../domain/adminPresentation'

const { data, status, error, staleWarning, refreshing, execute } = useLatestRequest<Awaited<ReturnType<typeof getAdminOverview>>>()

async function load(refresh = false): Promise<void> {
  await execute((signal) => getAdminOverview(signal), { intent: refresh ? 'silent' : 'replace' })
}

onMounted(() => void load())
</script>

<template>
  <section class="admin-overview-page">
    <header class="admin-page-heading">
      <div>
        <p class="eyebrow">
          OPERATIONS · 账号与服务元数据
        </p>
        <h1>运行概况</h1>
        <p>查看账号状态、服务连通性和存储使用情况，不读取或聚合任何用户账目。</p>
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
        {{ refreshing ? '刷新中…' : '刷新概况' }}
      </button>
    </header>

    <div class="privacy-boundary">
      <ShieldCheck
        :size="18"
        aria-hidden="true"
      />
      隐私边界：接口模型不包含商品、收入名称、付款方、金额、位置或账目字段
    </div>

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
      title="正在检查运行状态"
      message="只读取账号和服务元数据。"
    />
    <AppStateBlock
      v-else-if="status === 'error'"
      :kind="error?.kind === 'forbidden' ? 'permission' : 'error'"
      title="运行概况不可用"
      :message="error?.message"
      action-label="重试"
      @action="load()"
    />

    <template v-else-if="status === 'ready' && data">
      <div class="admin-metric-grid">
        <article class="admin-metric-card admin-account-metric">
          <div class="admin-metric-icon">
            <Users
              :size="20"
              aria-hidden="true"
            />
          </div>
          <p>普通用户</p>
          <strong>{{ data.accounts.total }}</strong>
          <dl>
            <div><dt>正常</dt><dd>{{ data.accounts.active }}</dd></div>
            <div><dt>待首次登录</dt><dd>{{ data.accounts.pendingFirstLogin }}</dd></div>
            <div><dt>已停用</dt><dd>{{ data.accounts.disabled }}</dd></div>
            <div><dt>注销处理中</dt><dd>{{ data.accounts.deletionPending }}</dd></div>
            <div><dt>有效会话</dt><dd>{{ data.accounts.activeSessions }}</dd></div>
          </dl>
          <small>最近活跃：{{ formatAdminTime(data.accounts.lastActiveAt) }}</small>
        </article>

        <article
          class="admin-metric-card"
          data-tone="success"
        >
          <div class="admin-metric-icon">
            <HeartPulse
              :size="20"
              aria-hidden="true"
            />
          </div>
          <p>服务健康</p>
          <strong>正常</strong>
          <small>检查时间：{{ formatAdminTime(data.service.checkedAt) }}</small>
        </article>

        <article
          class="admin-metric-card"
          data-tone="warning"
        >
          <div class="admin-metric-icon">
            <Archive
              :size="20"
              aria-hidden="true"
            />
          </div>
          <p>生产备份</p>
          <strong>未配置</strong>
          <small>接入真实备份任务前不展示虚假成功状态。</small>
        </article>

        <article class="admin-metric-card">
          <div class="admin-metric-icon">
            <Database
              :size="20"
              aria-hidden="true"
            />
          </div>
          <p>数据库已用</p>
          <strong>{{ formatAdminBytes(data.storage.databaseBytes) }}</strong>
          <small>来自当前 PostgreSQL 数据库实际占用。</small>
        </article>
      </div>
    </template>
  </section>
</template>
