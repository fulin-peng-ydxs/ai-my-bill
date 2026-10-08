<script setup lang="ts">
import { computed, nextTick, reactive, watch } from 'vue'

import DictionaryManager from '../components/DictionaryManager.vue'
import { useDictionaryPanel } from '../composables/useDictionaryPanel'
import type { DailyTemplateSelection } from '../api/dailyTemplates'
import AppStateBlock from '../components/AppStateBlock.vue'
import PageHeading from '../components/PageHeading.vue'
import DailyEntryPicker from '../components/DailyEntryPicker.vue'
import EntryTypeSwitch from '../components/EntryTypeSwitch.vue'
import ExpenseEntryForm from '../components/ExpenseEntryForm.vue'
import IncomeEntryForm from '../components/IncomeEntryForm.vue'
import type { EntryType } from '../domain/preferences'
import { usePreferencesStore } from '../stores/preferences'
import { useSessionStore } from '../stores/session'

const dictionariesOpen = useDictionaryPanel('entry')
const preferences = usePreferencesStore()
const session = useSessionStore()
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
  <article
    class="entry-preference-page"
    data-page-key="ledger-entry"
  >
    <PageHeading title="记一笔">
      <button
        type="button"
        class="text-action"
        aria-label="管理常用选项"
        @click="dictionariesOpen = true"
      >
        常用选项
      </button>
      <DailyEntryPicker
        :entry-type="preferences.values.recentEntryType"
        @select="applyTemplate"
      />
    </PageHeading>
    <section
      class="entry-type-panel"
      aria-label="本次记录"
    >
      <EntryTypeSwitch
        :model-value="preferences.values.recentEntryType"
        :disabled="preferences.status === 'loading' || preferences.isSaving"
        @update:model-value="selectType"
      />
      <AppStateBlock
        v-if="saveState === 'saving'"
        kind="loading"
        title="正在保存最近类型"
        message="选择已经生效，正在同步到当前账号。"
      />
      <AppStateBlock
        v-else-if="saveState === 'error'"
        kind="error"
        title="最近类型尚未同步"
        message="当前选择会保留在本次会话中，可以原位重试。"
        action-label="重试"
        @action="preferences.retry('recentEntryType').catch(() => undefined)"
      />
      <KeepAlive :max="2">
        <ExpenseEntryForm
          v-if="preferences.values.recentEntryType === 'EXPENSE'"
          :account-id="session.session?.accountId"
          :default-funding-channel-id="preferences.values.defaultFundingChannelId"
          :template-selection="templateStates.EXPENSE.selection"
          :template-revision="templateStates.EXPENSE.revision"
          @template-consumed="clearTemplate('EXPENSE')"
        />
        <IncomeEntryForm
          v-else
          :account-id="session.session?.accountId"
          :default-funding-channel-id="preferences.values.defaultFundingChannelId"
          :template-selection="templateStates.INCOME.selection"
          :template-revision="templateStates.INCOME.revision"
          @template-consumed="clearTemplate('INCOME')"
        />
      </KeepAlive>
    </section>
    <DictionaryManager
      v-model:open="dictionariesOpen"
      origin="entry"
    />
  </article>
</template>
