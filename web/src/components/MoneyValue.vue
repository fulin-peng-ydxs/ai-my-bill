<script setup lang="ts">
import { computed } from 'vue'
import { formatCny } from '../domain/money'

const props = defineProps<{ amount: string, tone?: 'income' | 'expense', sign?: '+' | '−' | '-' | '' }>()
const formatted = computed(() => formatCny(props.amount))
const zero = computed(() => /^-?0(?:\.0+)?$/.test(props.amount))
const negative = computed(() => formatted.value.startsWith('-') && !zero.value)
// 结余按实际正负判断；收支记录由调用者传入业务方向，不把正数支出误认为收入。
const tone = computed(() => props.tone ?? (zero.value ? 'neutral' : negative.value ? 'expense' : 'income'))
const prefix = computed(() => `${negative.value ? '−' : props.sign ?? (props.tone || zero.value ? '' : '+')}¥`)
const digits = computed(() => formatted.value.replace(/^-?¥/, ''))
</script>

<template>
  <span
    class="money-value"
    :class="`money-${tone}`"
  >{{ prefix }}{{ digits }}</span>
</template>
