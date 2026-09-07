<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppDrawer from '../components/AppDrawer.vue'
import AppDialog from '../components/AppDialog.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import AppToast from '../components/AppToast.vue'
import DataExportAction from '../components/DataExportAction.vue'
import FormField from '../components/FormField.vue'
import PwaInstallPrompt from '../components/PwaInstallPrompt.vue'
import SettingsDisclosureList, { type SettingsDisclosureItem } from '../components/SettingsDisclosureList.vue'
import ThemeModeControl from '../components/ThemeModeControl.vue'
import { useLogout } from '../composables/useLogout'
import { usePwaInstallStore } from '../pwa/install'
import { listDictionaryCandidates, type DictionaryItem } from '../api/dictionaries'
import {
  ledgerRangeOptions,
  preferenceLabel,
  reportRangeOptions,
  type LedgerDefaultRange,
  type ReportDefaultRange,
} from '../domain/preferences'
import { usePreferencesStore, type PreferenceField } from '../stores/preferences'
import { useSessionStore } from '../stores/session'
import { useThemeStore } from '../stores/theme'
import { themeModeLabel } from '../theme/theme'

const sessionStore = useSessionStore()
const router = useRouter()
const themeStore = useThemeStore()
const installStore = usePwaInstallStore()
const preferencesStore = usePreferencesStore()
const { loggingOut, logoutError, logout } = useLogout()
const activeSetting = ref<'funding' | 'ledgerRange' | 'reportRange' | 'appearance' | 'install'>()
const resetOpen = ref(false)
const fundingChannels = ref<DictionaryItem[]>([])
const fundingLoading = ref(true)
const fundingError = ref<string>()
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const fullExportRequest = { scope: 'ALL_DATA' as const }
const drawerOpen = computed({
  get: () => activeSetting.value !== undefined,
  set: (open: boolean) => { if (!open) activeSetting.value = undefined },
})
const fundingOptions = computed(() => {
  const currentId = preferencesStore.values.defaultFundingChannelId
  if (!currentId || fundingChannels.value.some((item) => item.id === currentId)
    || !preferencesStore.defaultFundingChannelName) return fundingChannels.value
  return [{
    id: currentId,
    type: 'funding-channel' as const,
    name: preferencesStore.defaultFundingChannelName,
    status: 'ACTIVE' as const,
    sortOrder: 0,
    referenced: true,
  }, ...fundingChannels.value]
})
const settingItems = computed<SettingsDisclosureItem[]>(() => [
  {
    key: 'funding', label: '默认资金渠道',
    value: fundingOptions.value.find((item) => item.id === preferencesStore.values.defaultFundingChannelId)?.name ?? '未设置',
  },
  {
    key: 'ledgerRange', label: '明细默认范围',
    value: preferenceLabel(ledgerRangeOptions, preferencesStore.values.ledgerDefaultRange),
  },
  {
    key: 'reportRange', label: '报表默认范围',
    value: preferenceLabel(reportRangeOptions, preferencesStore.values.reportDefaultRange),
  },
  { key: 'appearance', label: '外观', value: themeModeLabel(themeStore.mode) },
  { key: 'install', label: '安装到桌面', value: installStore.status === 'installed' ? '已安装' : '查看方式' },
])

const activeField = computed<PreferenceField | undefined>(() => ({
  funding: 'defaultFundingChannelId', ledgerRange: 'ledgerDefaultRange',
  reportRange: 'reportDefaultRange', appearance: 'themeMode', install: undefined,
})[activeSetting.value ?? 'install'] as PreferenceField | undefined)
const drawerTitle = computed(() => ({
  funding: '默认资金渠道', ledgerRange: '明细默认范围', reportRange: '报表默认范围',
  appearance: '外观', install: '安装到桌面',
})[activeSetting.value ?? 'install'])
const drawerDescription = computed(() => activeSetting.value === 'funding'
  ? '支出显示为支付方式，收入显示为收款方式。'
  : activeSetting.value === 'ledgerRange' || activeSetting.value === 'reportRange'
    ? '清除临时筛选后也会恢复到这里。'
    : activeSetting.value === 'appearance'
      ? '主题立即生效，并安全同步到当前账号。'
      : '安装能力不可用时，网页模式仍保留完整功能。')

function openSetting(key: string): void {
  if (['funding', 'ledgerRange', 'reportRange', 'appearance', 'install'].includes(key)) {
    activeSetting.value = key as typeof activeSetting.value
  }
}

function updatePreference(patch: Parameters<typeof preferencesStore.update>[0]): void {
  void preferencesStore.update(patch).catch(() => undefined)
}

function retryActive(): void {
  if (activeField.value) void preferencesStore.retry(activeField.value).catch(() => undefined)
}

function retryPreferences(): void {
  const accountId = sessionStore.session?.accountId
  if (accountId) void preferencesStore.initialize(accountId)
}

async function loadFundingChannels(): Promise<void> {
  fundingLoading.value = true
  fundingError.value = undefined
  try {
    fundingChannels.value = (await listDictionaryCandidates('funding-channel')).items
  } catch (error) {
    fundingError.value = error instanceof Error ? error.message : '资金渠道加载失败。'
  } finally {
    fundingLoading.value = false
  }
}

async function confirmReset(): Promise<void> {
  try {
    await preferencesStore.reset()
    resetOpen.value = false
  } catch {
    // 统一状态块保留错误与原偏好。
  }
}

function showExportNotice(message: string, kind: 'success' | 'error'): void {
  toastMessage.value = message
  toastKind.value = kind
  toastOpen.value = true
}

onMounted(loadFundingChannels)
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
          <p>选择立即生效并异步同步；失败时保留本次会话值。</p>
        </div>
      </div>
      <SettingsDisclosureList
        label="偏好设置"
        :items="settingItems"
        @select="openSetting"
      />
      <AppStateBlock
        v-if="preferencesStore.status === 'error'"
        kind="error"
        title="云端偏好暂时不可用"
        :message="preferencesStore.errorMessage ?? '已使用当前设备的安全回退值。'"
        action-label="重试"
        @action="retryPreferences"
      />
      <p class="preference-caption">
        最近记账类型：{{ preferencesStore.values.recentEntryType === 'EXPENSE' ? '支出' : '收入' }} · 在“记一笔”中自动记录
      </p>
      <button
        type="button"
        class="text-action reset-preferences-action"
        :disabled="preferencesStore.isSaving"
        @click="resetOpen = true"
      >
        恢复默认偏好
      </button>
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
          <p>管理当前账号的记账候选项与个人数据副本。</p>
        </div>
      </div>
      <SettingsDisclosureList
        label="数据与安全"
        :items="[{ key: 'dictionaries', label: '管理个人字典', value: '8 类' }]"
        @select="router.push({ name: 'personal-dictionaries' })"
      >
        <DataExportAction
          :request="fullExportRequest"
          presentation="setting"
          @notify="showExportNotice"
        />
      </SettingsDisclosureList>
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
      :title="drawerTitle"
      :description="drawerDescription"
    >
      <div
        v-if="activeSetting !== 'install'"
        class="drawer-setting-content"
      >
        <AppStateBlock
          v-if="preferencesStore.status === 'loading'"
          kind="loading"
          title="正在读取偏好"
        />
        <AppStateBlock
          v-else-if="fundingLoading && activeSetting === 'funding'"
          kind="loading"
          title="正在读取资金渠道"
        />
        <AppStateBlock
          v-else-if="fundingError && activeSetting === 'funding'"
          kind="error"
          title="资金渠道加载失败"
          :message="fundingError"
          action-label="重试"
          @action="loadFundingChannels"
        />
        <FormField
          v-else-if="activeSetting === 'funding'"
          field-id="default-funding-channel"
          label="默认资金渠道"
        >
          <template #default="{ describedBy }">
            <select
              id="default-funding-channel"
              :value="preferencesStore.values.defaultFundingChannelId ?? ''"
              :aria-describedby="describedBy"
              :disabled="preferencesStore.isSaving"
              @change="updatePreference({ defaultFundingChannelId: ($event.target as HTMLSelectElement).value || null })"
            >
              <option value="">
                未设置
              </option>
              <option
                v-for="channel in fundingOptions"
                :key="channel.id"
                :value="channel.id"
              >
                {{ channel.name }}（资金渠道）
              </option>
            </select>
          </template>
        </FormField>
        <FormField
          v-else-if="activeSetting === 'ledgerRange'"
          field-id="ledger-default-range"
          label="默认时间范围"
        >
          <template #default="{ describedBy }">
            <select
              id="ledger-default-range"
              :value="preferencesStore.values.ledgerDefaultRange"
              :aria-describedby="describedBy"
              :disabled="preferencesStore.isSaving"
              @change="updatePreference({ ledgerDefaultRange: ($event.target as HTMLSelectElement).value as LedgerDefaultRange })"
            >
              <option
                v-for="option in ledgerRangeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </template>
        </FormField>
        <FormField
          v-else-if="activeSetting === 'reportRange'"
          field-id="report-default-range"
          label="默认时间范围"
        >
          <template #default="{ describedBy }">
            <select
              id="report-default-range"
              :value="preferencesStore.values.reportDefaultRange"
              :aria-describedby="describedBy"
              :disabled="preferencesStore.isSaving"
              @change="updatePreference({ reportDefaultRange: ($event.target as HTMLSelectElement).value as ReportDefaultRange })"
            >
              <option
                v-for="option in reportRangeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </template>
        </FormField>
        <ThemeModeControl
          v-else-if="activeSetting === 'appearance'"
          :disabled="preferencesStore.isSaving"
        />
        <AppStateBlock
          v-if="activeField && preferencesStore.fieldStates[activeField] === 'saving'"
          kind="loading"
          title="正在保存偏好"
          message="当前选择已经生效。"
        />
        <AppStateBlock
          v-else-if="activeField && preferencesStore.fieldStates[activeField] === 'error'"
          kind="error"
          title="偏好尚未同步"
          :message="preferencesStore.errorMessage ?? '当前选择已保留，可以重试。'"
          action-label="重试"
          @action="retryActive"
        />
      </div>
      <PwaInstallPrompt v-else-if="activeSetting === 'install'" />
    </AppDrawer>

    <AppDialog
      id="reset-preferences-confirm"
      v-model:open="resetOpen"
      title="恢复默认偏好？"
      description="资金渠道、明细范围、报表范围、最近记账类型和主题都会恢复默认。"
      confirm-label="确认恢复"
      :busy="preferencesStore.isSaving"
      @confirm="confirmReset"
    >
      <AppStateBlock
        v-if="preferencesStore.errorMessage"
        kind="error"
        title="恢复未完成"
        :message="preferencesStore.errorMessage"
      />
    </AppDialog>
    <AppToast
      v-model:open="toastOpen"
      :message="toastMessage"
      :kind="toastKind"
    />
  </article>
</template>
