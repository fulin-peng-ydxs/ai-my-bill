<script setup lang="ts">
import { computed, inject, onActivated, onDeactivated, ref } from 'vue'
import { pageActionTarget } from '../composables/pageActionTarget'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'

const props = withDefaults(defineProps<{ submitting: boolean, primaryLabel: string, continueVisible?: boolean, viewportPinned?: boolean, formId?: string }>(), {
  continueVisible: true,
  viewportPinned: false,
  formId: undefined,
})
defineEmits<{ continue: [] }>()
const target = inject(pageActionTarget, undefined)
const active = ref(true)
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false })
const { keyboardOpen } = useKeyboardViewport()
const docked = computed(() => Boolean(active.value && props.viewportPinned && target?.value && !keyboardOpen.value))
const teleportTarget = computed(() => target?.value ?? 'body')
</script>

<template>
  <Teleport
    :to="teleportTarget"
    :disabled="!docked"
  >
    <div
      class="entry-savebar"
      :class="{ 'entry-savebar-single': !continueVisible, 'entry-savebar-docked': docked }"
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
        :form="formId"
        class="primary-button"
        :disabled="submitting"
      >
        {{ submitting ? '保存中…' : primaryLabel }}
      </button>
    </div>
  </Teleport>
</template>
