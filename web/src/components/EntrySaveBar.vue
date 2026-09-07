<script setup lang="ts">
withDefaults(defineProps<{ submitting: boolean, primaryLabel: string, continueVisible?: boolean }>(), {
  continueVisible: true,
})
defineEmits<{ continue: [] }>()
</script>

<template>
  <div
    class="entry-savebar"
    :class="{ 'entry-savebar-single': !continueVisible }"
  >
    <button
      v-if="continueVisible"
      type="button"
      class="secondary-button"
      :disabled="submitting"
      @click="$emit('continue')"
    >
      {{ submitting ? '保存中…' : '保存并继续' }}
    </button>
    <button
      type="submit"
      class="primary-button"
      :disabled="submitting"
    >
      {{ submitting ? '保存中…' : primaryLabel }}
    </button>
  </div>
</template>
