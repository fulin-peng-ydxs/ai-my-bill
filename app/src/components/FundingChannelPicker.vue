<script setup lang="ts">
import { WalletCards } from 'lucide-vue-next'
import DictionaryCombobox, { type DictionaryChoice } from './DictionaryCombobox.vue'

defineProps<{
  items: DictionaryChoice[]
  label?: string
  modelValue?: string
  disabled?: boolean
  error?: string
  loading?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string], selected: [item: DictionaryChoice] }>()

function select(item: DictionaryChoice): void {
  emit('selected', item)
  emit('update:modelValue', item.id)
}
</script>

<template>
  <DictionaryCombobox
    :input-id="label === '收款方式' ? 'income-funding-channel' : 'expense-funding-channel'"
    type="funding-channel"
    :label="label ?? '支付方式'"
    :label-icon="WalletCards"
    :items="items"
    :model-value="modelValue"
    :disabled="disabled || loading"
    :error="error"
    @select="select"
    @clear="emit('update:modelValue', '')"
  />
</template>
