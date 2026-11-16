<script setup lang="ts">
import { SlidersHorizontal } from 'lucide-vue-next'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useContentMotion } from '../composables/useContentMotion'

import DictionaryManager from '../components/DictionaryManager.vue'
import { useDictionaryPanel } from '../composables/useDictionaryPanel'
import type { DailyTemplateSelection } from '../api/dailyTemplates'
import AppStatusNotice from '../components/AppStatusNotice.vue'
import PageWorkspace from '../components/PageWorkspace.vue'
import PageHeading from '../components/PageHeading.vue'
import DailyEntryPicker from '../components/DailyEntryPicker.vue'
import EntryTypeSwitch from '../components/EntryTypeSwitch.vue'
import ExpenseEntryForm from '../components/ExpenseEntryForm.vue'
import IncomeEntryForm from '../components/IncomeEntryForm.vue'
import type { EntryType } from '../domain/preferences'
import { usePreferencesStore } from '../stores/preferences'

const dictionariesOpen = useDictionaryPanel('entry')
const preferences = usePreferencesStore()
const formPanel = ref<globalThis.HTMLElement>()
const formMotion = useContentMotion()
watch(() => preferences.values.recentEntryType, async () => {
  await nextTick()
  void formMotion.play(formPanel.value)
})
const saveState = computed(() => preferences.fieldStates.recentEntryType)
const templateStates = reactive<Record<EntryType, { selection?: DailyTemplateSelection, revision: number }>>({
  EXPENSE: { revision: 0 },
  INCOME: { revision: 0 },
})

function selectType(type: EntryType): void {
  void preferences.update({ recentEntryType: type }).catch(() => undefined)
}

async function applyTemplate(selection: DailyTemplateSelection): Promise<void> {
  if (preferences.isSaving) {
    await new Promise<void>((resolve) => {
      const stop = watch(() => preferences.isSaving, (saving) => {
        if (!saving) { stop(); resolve() }
      }, { immediate: true })
    })
  }
  selectType(selection.entryType)
  await nextTick()
  const state = templateStates[selection.entryType]
  state.selection = selection
  state.revision += 1
}

function clearTemplate(type: EntryType): void {
  templateStates[type].selection = undefined
}
</script>

<template>
  <PageWorkspace
    content-label="记账表单"
    content-layout="fill"
    class="entry-preference-page"
    data-page-key="ledger-entry"
  >
    <template #header>
      <PageHeading title="记一笔">
        <DailyEntryPicker
          :entry-type="preferences.values.recentEntryType"
          @select="applyTemplate"
        />
        <button
          type="button"
          class="compact-action"
          aria-label="打开选项管理"
          title="选项管理"
          @click="dictionariesOpen = true"
        >
          <SlidersHorizontal
            :size="20"
            :stroke-width="1.7"
            aria-hidden="true"
          />
        </button>
      </PageHeading>
      <EntryTypeSwitch
        :model-value="preferences.values.recentEntryType"
        :disabled="preferences.status === 'idle' || preferences.status === 'loading' || preferences.isSaving"
        @update:model-value="selectType"
      />
    </template>
    <section
      ref="formPanel"
      class="entry-type-panel workspace-grow"
      aria-label="本次记录"
    >
      <AppStatusNotice
        v-if="saveState === 'error'"
        :error="preferences.requestError"
        :busy="preferences.isSaving"
        title="记账类型偏好未保存"
        message="当前收支类型已在本次使用中生效，不影响继续记账。重试后可保存下次进入时默认使用的类型。"
        action-label="重试"
        @action="preferences.retry('recentEntryType').catch(() => undefined)"
      />
      <KeepAlive :max="2">
        <ExpenseEntryForm
          v-if="preferences.values.recentEntryType === 'EXPENSE'"
          :default-funding-channel-id="preferences.values.defaultFundingChannelId"
          :template-selection="templateStates.EXPENSE.selection"
          :template-revision="templateStates.EXPENSE.revision"
          @template-consumed="clearTemplate('EXPENSE')"
        />
        <IncomeEntryForm
          v-else
          :default-funding-channel-id="preferences.values.defaultFundingChannelId"
          :template-selection="templateStates.INCOME.selection"
          :template-revision="templateStates.INCOME.revision"
          @template-consumed="clearTemplate('INCOME')"
        />
      </KeepAlive>
    </section>
    <template #overlays>
      <DictionaryManager
        v-model:open="dictionariesOpen"
        origin="entry"
      />
    </template>
  </PageWorkspace>
</template>
