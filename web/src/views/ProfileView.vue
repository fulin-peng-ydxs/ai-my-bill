<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import AppDrawer from '../components/AppDrawer.vue'
import AppDialog from '../components/AppDialog.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import AppToast from '../components/AppToast.vue'
import DataExportAction from '../components/DataExportAction.vue'
import PageHeading from '../components/PageHeading.vue'
import DictionaryManager from '../components/DictionaryManager.vue'
import { useRefreshOnReturn } from '../composables/useRefreshOnReturn'
import { useDictionaryPanel } from '../composables/useDictionaryPanel'
import PasswordChangeSheet from '../components/PasswordChangeSheet.vue'
import FormField from '../components/FormField.vue'
import DictionaryCombobox, { type DictionaryChoice } from '../components/DictionaryCombobox.vue'
import PwaInstallPrompt from '../components/PwaInstallPrompt.vue'
import SettingsDisclosureList, { type SettingsDisclosureItem } from '../components/SettingsDisclosureList.vue'
import ThemeModeControl from '../components/ThemeModeControl.vue'
import { useLogout } from '../composables/useLogout'
import { clearAccountMemory } from '../composables/accountMemory'
import { usePwaInstallStore } from '../pwa/install'
import { deleteCurrentAccount } from '../api/accountDeletion'
import { normalizeRequestError } from '../api/errors'
import { clearAccountStorage } from '../storage/accountStorage'
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
const dictionariesOpen = useDictionaryPanel('profile')
const passwordOpen = ref(false)
const themeStore = useThemeStore()
const installStore = usePwaInstallStore()
const preferencesStore = usePreferencesStore()
const { loggingOut, logoutError, logout } = useLogout()
const activeSetting = ref<'funding' | 'ledgerRange' | 'reportRange' | 'appearance' | 'install'>()
const resetOpen = ref(false)
const deletionOpen = ref(false)
const deletionConfirmation = ref('')
const deletionError = ref('')
const deletionBusy = ref(false)
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
    value: fundingOptions.value.find((item) => item.id === preferencesStore.values.defaultFundingChannelId)?.name
      ?? preferencesStore.defaultFundingChannelName ?? '未设置',
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
      ? '选择后立即生效。'
      : '安装能力不可用时，网页模式仍保留完整功能。')

function openSetting(key: string): void {
  if (['funding', 'ledgerRange', 'reportRange', 'appearance', 'install'].includes(key)) {
    activeSetting.value = key as typeof activeSetting.value
    if (key === 'funding' && fundingLoading.value) void loadFundingChannels()
  }
}

function updatePreference(patch: Parameters<typeof preferencesStore.update>[0]): void {
  void preferencesStore.update(patch).catch(() => undefined)
}

function selectDefaultFunding(item: DictionaryChoice): void {
  if (!fundingChannels.value.some((channel) => channel.id === item.id)) {
    fundingChannels.value = [{ id: item.id, name: item.name, type: 'funding-channel', status: 'ACTIVE', sortOrder: 0, referenced: false }, ...fundingChannels.value]
  }
  updatePreference({ defaultFundingChannelId: item.id })
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

function openDeletion(): void {
  deletionConfirmation.value = ''
  deletionError.value = ''
  deletionOpen.value = true
}

async function confirmDeletion(): Promise<void> {
  const accountId = sessionStore.session?.accountId
  if (!accountId || deletionBusy.value) return
  deletionError.value = ''
  deletionBusy.value = true
  try {
    await deleteCurrentAccount(deletionConfirmation.value)
    await finishDeletion(accountId)
  } catch (cause) {
    // 会话失效也可能来自过期、改密或停用，绝不能据此推断注销成功或清理草稿。
    const requestError = normalizeRequestError(cause)
    deletionError.value = requestError.fieldErrors.confirmation?.[0] ?? `${requestError.message} 未确认注销成功，本地数据已保留；请重新登录核实或重试。`
  } finally {
    deletionBusy.value = false
  }
}

async function finishDeletion(accountId: string): Promise<void> {
  await clearAccountStorage(accountId)
  clearAccountMemory(accountId)
  sessionStore.clear()
  deletionOpen.value = false
  await router.replace({ name: 'login', query: { deleted: '1' } })
}

function showExportNotice(message: string, kind: 'success' | 'error'): void {
  toastMessage.value = message
  toastKind.value = kind
  toastOpen.value = true
}

useRefreshOnReturn(() => { if (!fundingLoading.value) return loadFundingChannels() })
</script>

<template>
  <article
    class="settings-page"
    data-page-key="profile-settings"
  >
    <PageHeading
      title="我的"
      :subtitle="sessionStore.session?.username"
    />

    <section
      class="settings-section"
      aria-labelledby="preferences-title"
    >
      <div class="section-heading">
        <div>
          <h2
            id="preferences-title"
            class="section-title"
          >
            偏好设置
          </h2>
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
        最近记账：{{ preferencesStore.values.recentEntryType === 'EXPENSE' ? '支出' : '收入' }}
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
          <h2
            id="data-security-title"
            class="section-title"
          >
            数据与安全
          </h2>
        </div>
      </div>
      <SettingsDisclosureList
        label="数据与安全"
        :items="[{ key: 'dictionaries', label: '常用选项', value: '8 类' }, { key: 'password', label: '修改密码', value: '' }]"
        @select="$event === 'password' ? passwordOpen = true : dictionariesOpen = true"
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
          <h2
            id="account-title"
            class="section-title"
          >
            账号操作
          </h2>
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
      <button
        class="text-action danger-text delete-account-action"
        type="button"
        :disabled="deletionBusy"
        @click="openDeletion"
      >
        注销账号
      </button>
    </section>

    <DictionaryManager
      v-model:open="dictionariesOpen"
      origin="profile"
    />
    <PasswordChangeSheet
      v-model:open="passwordOpen"
      @saved="showExportNotice('密码已更新，其他设备需重新登录。', 'success')"
    />

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
        <DictionaryCombobox
          v-else-if="activeSetting === 'funding'"
          input-id="default-funding-channel"
          :clear-on-input="false"
          type="funding-channel"
          label="默认资金渠道"
          optional
          :items="fundingOptions"
          :model-value="preferencesStore.values.defaultFundingChannelId ?? ''"
          :disabled="preferencesStore.isSaving"
          @select="selectDefaultFunding"
          @clear="updatePreference({ defaultFundingChannelId: null })"
        />
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
      id="delete-account-confirm"
      v-model:open="deletionOpen"
      title="永久注销账号？"
      description="在线账号、账目、字典、导出文件和全部会话会立即删除且无法恢复；仅保留不含账目内容的匿名安全审计 180 天。备份副本随既定周期自然过期，恢复备份时必须重放注销清理。建议先完成数据导出。"
      confirm-label="永久注销"
      danger
      :busy="deletionBusy"
      :confirm-disabled="deletionConfirmation !== sessionStore.session?.username"
      @confirm="confirmDeletion"
    >
      <FormField
        field-id="deletion-confirmation"
        :label="`输入用户名 ${sessionStore.session?.username ?? ''} 以确认`"
        :error="deletionError"
      >
        <template #default="{ describedBy }">
          <input
            id="deletion-confirmation"
            v-model="deletionConfirmation"
            autocomplete="off"
            maxlength="64"
            :aria-describedby="describedBy"
          >
        </template>
      </FormField>
    </AppDialog>
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
