<script setup lang="ts">
import { computed } from 'vue'

import AppStateBlock from '../components/AppStateBlock.vue'
import EntryTypeSwitch from '../components/EntryTypeSwitch.vue'
import type { EntryType } from '../domain/preferences'
import { usePreferencesStore } from '../stores/preferences'

const preferences = usePreferencesStore()
const saveState = computed(() => preferences.fieldStates.recentEntryType)

function selectType(type: EntryType): void {
  void preferences.update({ recentEntryType: type }).catch(() => undefined)
}
</script>

<template>
  <article
    class="placeholder-page entry-preference-page"
    data-page-key="ledger-entry"
  >
    <p class="eyebrow">
      快速记账
    </p>
    <h1>记一笔</h1>
    <p>选择会作为当前账号下次进入时的默认类型。</p>
    <section
      class="placeholder-panel entry-type-panel"
      aria-labelledby="entry-type-title"
    >
      <div class="section-heading">
        <h2 id="entry-type-title">
          本次记录
        </h2>
        <p>支出与收入使用彼此独立的本地草稿空间，切换不会覆盖另一类内容。</p>
      </div>
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
      <p class="entry-stage-note">
        填报字段与保存能力将在后续对应阶段开放；这里不展示模拟账目。
      </p>
    </section>
  </article>
</template>
