<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import DictionaryIndexPanel from '../../../components/DictionaryIndexPanel.vue'
import PageHeading from '../../../components/PageHeading.vue'
const router = useRouter()
</script>

<template>
  <article
    class="settings-page dictionary-index-page"
    data-page-key="personal-dictionaries"
  >
    <PageHeading title="个人字典">
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
    </PageHeading>
    <section class="settings-section">
      <DictionaryIndexPanel @select="router.push({ name: 'personal-dictionary-detail', params: { type: $event } })" />
    </section>
  </article>
</template>
