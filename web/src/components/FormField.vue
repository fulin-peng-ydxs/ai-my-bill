<script setup lang="ts">
import { computed, useSlots } from 'vue'

const props = defineProps<{
  fieldId: string
  label: string
  help?: string
  error?: string
}>()

const slots = useSlots()
const helpId = computed(() => props.help || slots.help ? `${props.fieldId}-help` : undefined)
const errorId = computed(() => props.error ? `${props.fieldId}-error` : undefined)
const describedBy = computed(() => [helpId.value, errorId.value].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <div class="form-field">
    <label :for="fieldId">{{ label }}</label>
    <slot :described-by="describedBy" />
    <small
      v-if="helpId"
      :id="helpId"
    ><slot name="help">{{ help }}</slot></small>
    <small
      v-if="error"
      :id="errorId"
      class="field-error"
      role="alert"
    >{{ error }}</small>
  </div>
</template>
