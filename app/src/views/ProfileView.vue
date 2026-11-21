<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppDrawer from '../components/AppDrawer.vue'
import AppDialog from '../components/AppDialog.vue'
import AppStateBlock from '../components/AppStateBlock.vue'
import AppRequestError from '../components/AppRequestError.vue'
import AppStatusNotice from '../components/AppStatusNotice.vue'
import AppLoadingHint from '../components/AppLoadingHint.vue'
import AppToast from '../components/AppToast.vue'
import FormField from '../components/FormField.vue'
import PageWorkspace from '../components/PageWorkspace.vue'
import PageHeading from '../components/PageHeading.vue'
import SettingsGroup from '../components/SettingsGroup.vue'
import SettingsDisclosureList, { type SettingsDisclosureItem } from '../components/SettingsDisclosureList.vue'
import ThemeModeControl from '../components/ThemeModeControl.vue'
import DictionaryCombobox from '../components/DictionaryCombobox.vue'
import DictionaryManager from '../components/DictionaryManager.vue'
import DataExportAction from '../components/DataExportAction.vue'
import DataManagementActions from '../components/DataManagementActions.vue'
import { usePreferencesStore, type PreferenceField } from '../stores/preferences'
import { useThemeStore } from '../stores/theme'
import { useLatestRequest } from '../composables/useLatestRequest'
import { useDictionaryPanel } from '../composables/useDictionaryPanel'
import { listDictionaryCandidates } from '../api/dictionaries'
import { normalizeRequestError, canRetryRequest, type RequestError } from '../api/errors'
import { ledgerRangeOptions, reportRangeOptions, preferenceLabel, type PreferenceRequest, type LedgerDefaultRange, type ReportDefaultRange } from '../domain/preferences'
import { themeModeLabel } from '../theme/theme'
const preferencesStore = usePreferencesStore()
const theme = useThemeStore()
const dictionariesOpen = useDictionaryPanel('profile')
const drawerOpen = ref(false)
const activeSetting = ref('appearance')
const resetOpen = ref(false)
const resetError = ref<RequestError>()
const toastOpen = ref(false)
const toastMessage = ref('')
const toastKind = ref<'success' | 'error'>('success')
const fullExportRequest = { scope: 'ALL_DATA' as const }
const fundingRequest = useLatestRequest<Awaited<ReturnType<typeof listDictionaryCandidates>>>()
const fundingOptions = computed(() => fundingRequest.data.value?.items ?? [])
const fundingLoading = computed(() => fundingRequest.status.value === 'loading')
const fundingError = fundingRequest.error
async function loadFundingChannels() {
  await fundingRequest.execute(signal => listDictionaryCandidates('funding-channel', '', signal))
}
watch(drawerOpen, value => {
  if (value && activeSetting.value === 'funding') {
    void loadFundingChannels()
  }
})
const settingItems = computed<SettingsDisclosureItem[]>(() => [
  {
    key: 'funding',
    label: '默认资金渠道',
    value: fundingOptions.value.find(i => i.id === preferencesStore.values.defaultFundingChannelId)?.name
      ?? preferencesStore.defaultFundingChannelName ?? '未设置',
  },
  {
    key: 'ledgerRange',
    label: '明细默认范围',
    value: preferenceLabel(ledgerRangeOptions, preferencesStore.values.ledgerDefaultRange),
  },
  {
    key: 'reportRange',
    label: '报表默认范围',
    value: preferenceLabel(reportRangeOptions, preferencesStore.values.reportDefaultRange),
  },
  { key: 'appearance', label: '外观', value: themeModeLabel(theme.mode) },
])
const activeField = computed(() => ({
  funding: 'defaultFundingChannelId',
  ledgerRange: 'ledgerDefaultRange',
  reportRange: 'reportDefaultRange',
  appearance: 'themeMode',
})[activeSetting.value] as PreferenceField | undefined)
const drawerTitle = computed(() => settingItems.value.find(i => i.key === activeSetting.value)?.label ?? '')
const drawerDescription = computed(() => activeSetting.value === 'funding' ? '支出显示为支付方式，收入显示为收款方式。' : undefined)
function openSetting(key: string) {
  activeSetting.value = key
  drawerOpen.value = true
}
function updatePreference(value: Partial<PreferenceRequest>) {
  void preferencesStore.update(value).catch(() => undefined)
}
function selectDefaultFunding(item: { id: string }) {
  updatePreference({ defaultFundingChannelId: item.id })
}
async function retryPreferences() {
  await preferencesStore.retry(preferencesStore.status === 'error' ? undefined : activeField.value).catch(() => undefined)
}
async function retryActive() {
  await retryPreferences()
}
async function confirmReset() {
  try {
    await preferencesStore.reset()
    resetOpen.value = false
    toastKind.value = 'success'
    toastMessage.value = '偏好已恢复默认。'
    toastOpen.value = true
  } catch (error) {
    resetError.value = normalizeRequestError(error)
  }
}
function showExportNotice(message: string, kind: 'success' | 'error') {
  toastMessage.value = message
  toastKind.value = kind
  toastOpen.value = true
}
</script>

<template>
  <PageWorkspace
    class="settings-page"
    data-page-key="profile-settings"
    content-label="我的设置"
  >
    <template #header>
      <PageHeading
        title="我的"
      />
    </template>

    <SettingsGroup title="偏好设置">
      <SettingsDisclosureList
        label="偏好设置"
        :items="settingItems"
        @select="openSetting"
      />
      <AppStatusNotice
        v-if="preferencesStore.status === 'error'"
        :error="preferencesStore.requestError"
        :busy="preferencesStore.isSaving"
        title="偏好暂时不可用"
        :message="preferencesStore.errorMessage ?? '已使用当前设备的安全回退值。'"
        action-label="重试"
        @action="retryPreferences"
      />
      <div class="preference-footer">
        <p class="preference-caption">
          最近记账：{{ preferencesStore.values.recentEntryType === 'EXPENSE' ? '支出' : '收入' }}
        </p>
        <button
          type="button"
          class="text-action reset-preferences-action"
          :disabled="preferencesStore.isSaving"
          @click="resetError = undefined; resetOpen = true"
        >
          恢复默认偏好
        </button>
      </div>
    </SettingsGroup>

    <SettingsGroup title="数据与安全">
      <SettingsDisclosureList
        label="数据与安全"
        :items="[{ key: 'dictionaries', label: '选项管理', value: '8 类' }]"
        @select="dictionariesOpen = true"
      >
        <DataExportAction
          :request="fullExportRequest"
          presentation="setting"
          @notify="showExportNotice"
        />
        <DataManagementActions />
      </SettingsDisclosureList>
    </SettingsGroup>

    <template #overlays>
      <DictionaryManager
        v-model:open="dictionariesOpen"
        origin="profile"
      />
      <AppDrawer
        id="profile-setting"
        v-model:open="drawerOpen"
        :title="drawerTitle"
        :description="drawerDescription"
      >
        <div
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
          <AppRequestError
            v-else-if="fundingError && activeSetting === 'funding'"
            title="资金渠道加载失败"
            :error="fundingError"
            @retry="loadFundingChannels"
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
          <template v-if="activeSetting === 'funding'">
            <AppLoadingHint :pending="fundingRequest.refreshing.value" />
            <AppStatusNotice
              v-if="fundingRequest.staleWarning.value"
              title="资金渠道可能不是最新"
              :error="fundingRequest.staleWarning.value"
              message="当前仍显示上次成功结果。"
              action-label="重试"
              :busy="fundingRequest.refreshing.value"
              @action="loadFundingChannels"
            />
          </template>
          <AppStateBlock
            v-if="activeField && preferencesStore.fieldStates[activeField] === 'saving'"
            kind="loading"
            immediate
            title="正在保存偏好"
            message="当前选择已经生效。"
          />
          <AppStatusNotice
            v-else-if="activeField && preferencesStore.fieldStates[activeField] === 'error'"
            :error="preferencesStore.requestError"
            :busy="preferencesStore.isSaving"
            title="偏好尚未保存"
            :message="preferencesStore.errorMessage ?? '当前选择已保留，可以重试。'"
            action-label="重试"
            @action="retryActive"
          />
        </div>
      </AppDrawer>

      <AppDialog
        id="reset-preferences-confirm"
        v-model:open="resetOpen"
        title="恢复默认偏好？"
        description="资金渠道、明细范围、报表范围、最近记账类型和主题都会恢复默认。"
        confirm-label="确认恢复"
        :busy="preferencesStore.isSaving"
        :confirm-disabled="Boolean(resetError && !canRetryRequest(resetError))"
        @confirm="confirmReset"
      >
        <AppRequestError
          v-if="resetError"
          title="恢复未完成"
          :error="resetError"
          :show-retry="false"
        />
      </AppDialog>
      <AppToast
        v-model:open="toastOpen"
        :message="toastMessage"
        :kind="toastKind"
      />
    </template>
  </PageWorkspace>
</template>
