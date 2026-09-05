<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { listDictionarySummaries } from '../../../api/dictionaries'
import AppStateBlock from '../../../components/AppStateBlock.vue'
import SettingsDisclosureList, { type SettingsDisclosureItem } from '../../../components/SettingsDisclosureList.vue'
import { useLatestRequest } from '../../../composables/useLatestRequest'
import { dictionaryDefinitions, type DictionaryType } from '../../../domain/dictionaries'

const router = useRouter()
const { data, status, error, staleWarning, execute } = useLatestRequest<Awaited<ReturnType<typeof listDictionarySummaries>>>()

const items = computed<SettingsDisclosureItem[]>(() => dictionaryDefinitions.map((definition) => {
  const summary = data.value?.items.find((item) => item.type === definition.type)
  return {
    key: definition.type,
    label: definition.label,
    value: summary ? `${summary.active} 启用 · ${summary.total} 项` : '0 项',
  }
}))

async function load(intent: 'replace' | 'refresh' = 'replace'): Promise<void> {
  await execute((signal) => listDictionarySummaries(signal), { intent })
}

function openType(key: string): void {
  if (dictionaryDefinitions.some((item) => item.type === key)) {
    void router.push({ name: 'personal-dictionary-detail', params: { type: key as DictionaryType } })
  }
}

onMounted(() => void load())
</script>

<template>
  <article
    class="settings-page dictionary-index-page"
    data-page-key="personal-dictionaries"
  >
    <header class="dictionary-page-heading">
      <button
        type="button"
        class="icon-button"
        aria-label="返回我的"
        @click="router.push('/me')"
      >
        <ArrowLeft
          :size="20"
          aria-hidden="true"
        />
      </button>
      <div>
        <p class="eyebrow">
          PERSONAL LABELS · 仅当前账号
        </p>
        <h1>个人字典</h1>
        <p>管理记账时使用的候选项。停用后不影响历史账目。</p>
      </div>
    </header>

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
      title="正在读取个人字典"
      message="正在统计八类候选项。"
    />
    <AppStateBlock
      v-else-if="status === 'error'"
      :kind="error?.kind === 'forbidden' ? 'permission' : 'error'"
      title="个人字典暂不可用"
      :message="error?.message"
      action-label="重试"
      @action="load()"
    />
    <section
      v-else-if="status === 'ready'"
      class="settings-section"
      aria-labelledby="dictionary-types-title"
    >
      <div class="section-heading">
        <div>
          <h2 id="dictionary-types-title">
            八类字典
          </h2>
          <p>选择一类后新增、改名、排序、停用或恢复。</p>
        </div>
      </div>
      <SettingsDisclosureList
        label="个人字典类型"
        :items="items"
        @select="openType"
      />
    </section>
  </article>
</template>
