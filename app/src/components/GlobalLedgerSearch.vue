<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'
import { onDeactivated, ref, watch } from 'vue'
import { usePageActivity } from '../composables/usePageActivity'
import { unicodeCodePointLength } from '../domain/text'

import { useDebouncedQuery } from '../composables/useDebouncedQuery'

const props = withDefaults(defineProps<{
  id: string
  modelValue: string
  label?: string
  placeholder?: string
  maxLength?: number
  delay?: number
  contextKey?: string
}>(), {
  label: '搜索账目',
  placeholder: '搜索账目',
  delay: 300,
  maxLength: 200,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  search: [value: string]
}>()
const active = usePageActivity()
const input = ref<HTMLInputElement>()
let accepted = props.modelValue
let composing = false
let resumeAfterComposition = false
const query = useDebouncedQuery((value: string) => {
  if (active.value) emit('search', value)
}, props.delay)

function restoreInput(target = input.value): void {
  if (!target) return
  const position = Math.min(target.selectionStart ?? accepted.length, accepted.length)
  target.value = accepted
  target.setSelectionRange(position, position)
}
/** 外部清除/条件替换可取消同值的待执行任务，IME 的迟到结束也不能复活旧输入。 */
function cancelPending(): void {
  query.cancel()
  resumeAfterComposition = false
  composing = false
  restoreInput()
}
watch(() => props.modelValue, value => {
  // v-model 对本组件刚发出的值回显不属于外部替换，不能误取消正常防抖。
  if (value !== accepted) {
    accepted = value
    cancelPending()
  }
}, { flush: 'sync' })
watch(() => props.contextKey, cancelPending, { flush: 'sync' })
watch(active, value => { if (!value) cancelPending() }, { flush: 'sync' })
onDeactivated(cancelPending)
defineExpose({ cancelPending })

function canInsert(target: HTMLInputElement, text: string): boolean {
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? start
  return unicodeCodePointLength(target.value.slice(0, start) + text + target.value.slice(end)) <= props.maxLength
}
function beforeInput(event: InputEvent): void {
  if (!active.value) {
    event.preventDefault()
    return
  }
  if (!composing && !event.isComposing && event.inputType.startsWith('insert') && event.data !== null &&
    !canInsert(event.target as HTMLInputElement, event.data)) {
    event.preventDefault()
  }
}
function paste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text/plain')
  if (!active.value || text !== undefined && !canInsert(event.target as HTMLInputElement, text)) event.preventDefault()
}
function onInput(event: Event): void {
  if (composing || (event as InputEvent).isComposing) return
  const target = event.target as HTMLInputElement
  if (!active.value || unicodeCodePointLength(target.value) > props.maxLength) {
    // beforeinput/paste 之外的替换、撤销和 IME 最终提交仍以同一边界兜底。
    restoreInput(target)
    return
  }
  const value = target.value
  if (value === accepted) return
  accepted = value
  emit('update:modelValue', value)
  if (value === '') query.submit(value)
  else query.schedule(value)
}
function compositionStart(): void {
  if (composing) return
  // 组合输入只暂停尚未提交的合法搜索；外部取消会同时清除续发意图。
  resumeAfterComposition = query.isPending()
  composing = true
  query.cancel()
}
function compositionEnd(event: CompositionEvent): void {
  if (!composing) {
    restoreInput(event.target as HTMLInputElement)
    return
  }
  const resume = resumeAfterComposition
  resumeAfterComposition = false
  composing = false
  const previous = accepted
  onInput(event)
  // 取消预编辑或拒绝超限时 onInput 不调度；只补原先未提交的值，不重查已提交值。
  if (resume && active.value && accepted === previous) query.schedule(accepted)
}
function onEnter(event: KeyboardEvent): void {
  if (composing || event.isComposing || !active.value) return
  event.preventDefault()
  onInput(event)
  query.submit(accepted)
}
function clear(): void {
  if (!active.value) return
  cancelPending()
  accepted = ''
  emit('update:modelValue', '')
  query.submit('')
}
</script>

<template>
  <div class="global-search">
    <label
      class="sr-only"
      :for="id"
    >{{ label }}</label>
    <Search
      :size="18"
      aria-hidden="true"
    />
    <input
      ref="input"
      :id="id"
      type="search"
      enterkeyhint="search"
      :value="modelValue"
      :placeholder="placeholder"
      @beforeinput="beforeInput"
      @paste="paste"
      @compositionstart="compositionStart"
      @compositionend="compositionEnd"
      @input="onInput"
      @keydown.enter="onEnter"
    >
    <button
      v-if="modelValue"
      type="button"
      class="icon-button"
      aria-label="清空搜索"
      @click="clear"
    >
      <X
        :size="18"
        aria-hidden="true"
      />
    </button>
  </div>
</template>
