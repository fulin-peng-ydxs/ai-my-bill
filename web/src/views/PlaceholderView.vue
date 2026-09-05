<script setup lang="ts">
import type { PageRegistration } from '../app/pageRegistry'

defineProps<{
  page: PageRegistration
}>()
</script>

<template>
  <article
    class="placeholder-page"
    :data-page-key="page.pageKey"
  >
    <h1>{{ page.title }}</h1>
    <p>页面外壳已经就绪，具体业务能力将在开放后显示。</p>
    <section
      class="placeholder-panel"
      aria-label="页面契约"
    >
      <p>这里不会展示模拟账单。功能开放前，导航、权限和响应式布局仍保持可验证。</p>
      <dl class="placeholder-meta">
        <dt>页面类型</dt>
        <dd>{{ page.archetype }}</dd>
        <dt>访问角色</dt>
        <dd>{{ page.role }}</dd>
        <dt>原型依据</dt>
        <dd>{{ page.prototype }}</dd>
        <dt>状态契约</dt>
        <dd>{{ page.states.join(' / ') }}</dd>
      </dl>
    </section>
  </article>
</template>
