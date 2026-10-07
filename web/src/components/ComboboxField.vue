<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, Search } from 'lucide-vue-next'
import AnchoredDropdown from './AnchoredDropdown.vue'

const props = defineProps<{
  id: string, label: string, value: string, open: boolean,
  disabled?: boolean, invalid?: boolean, placeholder: string,
}>()
const emit = defineEmits<{
  open: [searching: boolean], close: [], input: [value: string], submit: [],
}>()
const mobile = ref(false)
const searching = ref(false)
const input = ref<globalThis.HTMLInputElement>()
const trigger = ref<globalThis.HTMLButtonElement>()
const dropdown = ref<{ focusFirst: () => void }>()
const anchor = computed(() => mobile.value && !searching.value ? trigger.value : input.value)
let media: globalThis.MediaQueryList | undefined
let restoringFocus = false

function syncMode(): void {
  mobile.value = media?.matches ?? false
  if (props.open) emit('close')
}
onMounted(() => {
  media = globalThis.window.matchMedia('(max-width: 735px)')
  mobile.value = media.matches
  media.addEventListener('change', syncMode)
})
onBeforeUnmount(() => media?.removeEventListener('change', syncMode))

function toggle(): void {
  if (props.open) emit('close')
  else emit('open', false)
}

/** 在用户手势内同步展示并聚焦输入，避免异步渲染错过 iOS 的键盘唤起时机。 */
function startSearch(): void {
  searching.value = true
  if (input.value) {
    input.value.style.display = ''
    restoringFocus = true
    input.value.focus()
    input.value.select()
    restoringFocus = false
  }
  emit('open', true)
}
function openInput(): void { if (!restoringFocus) emit('open', true) }
function focusOptions(): void {
  if (!props.open) emit('open', searching.value || !mobile.value)
  else dropdown.value?.focusFirst()
}
watch(() => props.open, async (open) => {
  if (open) return
  const active = globalThis.document.activeElement
  const restore = active === input.value || globalThis.document.getElementById(`${props.id}-options`)?.contains(active)
  if (mobile.value) { input.value?.blur(); searching.value = false }
  await nextTick()
  if (props.open || !restore) return
  restoringFocus = true
  anchor.value?.focus({ preventScroll: true })
  restoringFocus = false
})
watch(() => props.disabled, (disabled) => { if (disabled) emit('close') })
</script>

<template>
  <label :for="id">{{ label }}</label>
  <button
    v-if="mobile && !searching"
    :id="id"
    ref="trigger"
    type="button"
    class="combobox-trigger"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="`${id}-options`"
    :aria-invalid="invalid"
    :disabled="disabled"
    @click="toggle"
    @keydown.down.prevent="focusOptions"
  >
    <span :class="{ 'combobox-placeholder': !value }">{{ value || '请选择' }}</span>
    <ChevronDown
      :size="16"
      aria-hidden="true"
    />
  </button>
  <input
    v-show="!mobile || searching"
    :id="mobile && !searching ? undefined : id"
    ref="input"
    :value="value"
    :disabled="disabled"
    :placeholder="placeholder"
    autocomplete="off"
    enterkeyhint="search"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="`${id}-options`"
    :aria-invalid="invalid"
    @input="emit('input', ($event.target as HTMLInputElement).value)"
    @focus="openInput"
    @click="!open && openInput()"
    @keydown.enter.prevent="emit('submit')"
    @keydown.down.prevent="focusOptions"
  >
  <AnchoredDropdown
    :id="`${id}-options`"
    ref="dropdown"
    :anchor="anchor"
    :open="open"
    @close="emit('close')"
  >
    <button
      v-if="mobile && !searching"
      type="button"
      class="dropdown-action dropdown-search"
      @click="startSearch"
    >
      <Search
        :size="16"
        aria-hidden="true"
      /> 搜索或新增
    </button>
    <slot />
  </AnchoredDropdown>
</template>
