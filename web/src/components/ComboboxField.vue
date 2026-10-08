<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { ChevronDown, Search } from 'lucide-vue-next'
import AnchoredDropdown from './AnchoredDropdown.vue'
import { useActiveCombobox } from '../composables/useActiveCombobox'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'

const props = defineProps<{
  id: string, label: string, value: string, open: boolean,
  disabled?: boolean, invalid?: boolean, placeholder: string,
  displayValue?: string,
}>()
const emit = defineEmits<{
  open: [searching: boolean], close: [], input: [value: string], submit: [],
}>()
const mobile = ref(false)
const searching = ref(false)
const input = ref<globalThis.HTMLInputElement>()
const searchInput = ref<globalThis.HTMLInputElement>()
const searchHeader = ref<globalThis.HTMLElement>()
const trigger = ref<globalThis.HTMLButtonElement>()
const dropdown = ref<{ focusFirst: () => void }>()
const anchor = computed(() => mobile.value ? trigger.value : input.value)
const { keyboardOpen } = useKeyboardViewport()
let media: globalThis.MediaQueryList | undefined
let restoringFocus = false
let restoreOnClose = true
let blurTimer: ReturnType<typeof globalThis.setTimeout> | undefined

function cancelBlur(): void {
  if (blurTimer !== undefined) globalThis.clearTimeout(blurTimer)
  blurTimer = undefined
}

function close(restoreFocus = false): void {
  cancelBlur()
  restoreOnClose = restoreFocus
  emit('close')
}
useActiveCombobox(() => props.open, () => close(false))
watch(keyboardOpen, (open, wasOpen) => {
  // 只有真正出现过软键盘的搜索才能由收键盘结束，浏览态及地址栏变化不触发。
  if (wasOpen && !open && mobile.value && searching.value && props.open) scheduleSearchClose(false)
})

function syncMode(): void {
  mobile.value = media?.matches ?? false
  if (props.open) close(false)
}
onMounted(() => {
  media = globalThis.window.matchMedia('(max-width: 735px)')
  mobile.value = media.matches
  media.addEventListener('change', syncMode)
})
onActivated(() => { if (media) { mobile.value = media.matches; media.addEventListener('change', syncMode) } })
onDeactivated(() => { close(false); searching.value = false; media?.removeEventListener('change', syncMode) })
onBeforeUnmount(() => { cancelBlur(); media?.removeEventListener('change', syncMode) })

function toggle(): void {
  if (props.open) close(true)
  else { restoreOnClose = true; emit('open', false) }
}

/** 在用户手势内同步展示并聚焦输入，避免异步渲染错过 iOS 的键盘唤起时机。 */
function startSearch(): void {
  searching.value = true
  // 面板已经展开，在本次手势内显示搜索栏并聚焦，保留 iOS 键盘唤起资格。
  if (searchHeader.value) searchHeader.value.style.display = ''
  if (searchInput.value) {
    restoringFocus = true
    searchInput.value.focus({ preventScroll: true })
    searchInput.value.select()
    restoringFocus = false
  }
  emit('open', true)
}
function openInput(): void {
  if (!restoringFocus) { restoreOnClose = true; emit('open', true) }
}
function scheduleSearchClose(requireBlur: boolean): void {
  cancelBlur()
  // iOS 触摸可能先失焦再派发候选点击；让手势完成，原生“完成”则在短暂宽限后关闭。
  blurTimer = globalThis.setTimeout(() => {
    blurTimer = undefined
    if (!props.open || !mobile.value || !searching.value || !searchInput.value) return
    const active = globalThis.document.activeElement
    const panel = globalThis.document.getElementById(`${props.id}-options`)
    if (!requireBlur || (active !== searchInput.value && !panel?.contains(active))) close(false)
  }, 150)
}
function searchBlurred(): void { scheduleSearchClose(true) }
function focusOptions(): void {
  if (!props.open) emit('open', searching.value || !mobile.value)
  else dropdown.value?.focusFirst()
}
watch(() => props.open, async (open) => {
  if (open) return
  cancelBlur()
  const active = globalThis.document.activeElement
  const restore = restoreOnClose && (active === input.value
    || globalThis.document.getElementById(`${props.id}-options`)?.contains(active))
  if (mobile.value) { searchInput.value?.blur(); searching.value = false }
  await nextTick()
  if (props.open || !restore) return
  // 外部点按已经将焦点交给新字段时，旧字段不能在渲染后抢回焦点。
  const current = globalThis.document.activeElement
  if (current && current !== globalThis.document.body && current !== active) return
  restoringFocus = true
  anchor.value?.focus({ preventScroll: true })
  restoringFocus = false
})
watch(() => props.disabled, (disabled) => { if (disabled) close(false) })
</script>

<template>
  <label :for="id">{{ label }}</label>
  <button
    v-if="mobile"
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
    <span :class="{ 'combobox-placeholder': !(displayValue ?? value) }">{{ (displayValue ?? value) || '请选择' }}</span>
    <ChevronDown
      :size="16"
      aria-hidden="true"
    />
  </button>
  <input
    v-show="!mobile"
    :id="mobile ? undefined : id"
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
    @close="close"
    @interact="cancelBlur"
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
    <div
      v-if="mobile"
      v-show="searching"
      ref="searchHeader"
      class="dropdown-search-header"
    >
      <input
        :id="`${id}-search`"
        ref="searchInput"
        :value="value"
        :aria-label="`搜索${label}`"
        :aria-controls="`${id}-options`"
        :disabled="disabled"
        :placeholder="placeholder"
        autocomplete="off"
        enterkeyhint="search"
        @input="emit('input', ($event.target as HTMLInputElement).value)"
        @blur="searchBlurred"
        @keydown.enter.prevent="emit('submit')"
        @keydown.down.prevent="focusOptions"
      >
      <button
        type="button"
        class="text-action"
        @click="close(true)"
      >
        取消
      </button>
    </div>
    <slot />
  </AnchoredDropdown>
</template>
