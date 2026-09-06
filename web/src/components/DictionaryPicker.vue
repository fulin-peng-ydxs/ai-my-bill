<script setup lang="ts">
export interface DictionaryPickerItem {
  id: string
  name: string
}

withDefaults(defineProps<{
  label: string
  items: DictionaryPickerItem[]
  modelValue?: string
  optional?: boolean
  disabled?: boolean
  error?: string
}>(), { modelValue: '', optional: false, disabled: false, error: undefined })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <fieldset class="dictionary-picker">
    <legend>{{ label }}{{ optional ? '（选填）' : '' }}</legend>
    <div class="dictionary-picker-options">
      <button
        v-if="optional"
        type="button"
        :aria-pressed="!modelValue"
        :disabled="disabled"
        @click="emit('update:modelValue', '')"
      >
        未指定
      </button>
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        :aria-pressed="modelValue === item.id"
        :disabled="disabled"
        @click="emit('update:modelValue', item.id)"
      >
        {{ item.name }}
      </button>
    </div>
    <small
      v-if="error"
      class="field-error"
      role="alert"
    >{{ error }}</small>
  </fieldset>
</template>
