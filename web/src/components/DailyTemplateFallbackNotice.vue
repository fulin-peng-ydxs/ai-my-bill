<script setup lang="ts">
import { computed } from 'vue'

import type { DailyTemplateSelection } from '../api/dailyTemplates'
import AppStateBlock from './AppStateBlock.vue'

const props = defineProps<{ fields: DailyTemplateSelection['unavailableFields'] }>()
const labels: Record<DailyTemplateSelection['unavailableFields'][number], string> = {
  productId: '商品', primaryCategoryId: '一级分类', secondaryCategoryId: '二级分类', unitId: '单位',
  fundingChannelId: '资金渠道', purchaseChannelId: '购买渠道', locationLabelId: '地点',
  payerId: '付款方', incomeCategoryId: '收入分类',
}
const message = computed(() => `${props.fields.map((field) => labels[field]).join('、')}已失效，未回填这些字段，请重新选择后再保存。`)
</script>

<template>
  <AppStateBlock
    v-if="fields.length"
    kind="info"
    title="模板中的部分选项已不可用"
    :message="message"
  />
</template>
