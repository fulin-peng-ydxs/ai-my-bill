// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppAsyncRegion from './AppAsyncRegion.vue'
import { registerUnsavedChanges, requestDiscardChanges, cancelDiscardChanges, confirmDiscardChanges } from '../composables/unsavedChanges'
import { useKeyboardViewport } from '../composables/useKeyboardViewport'

describe('共享外壳状态和未保存保护', () => {
 it('个人外壳在键盘收起后结束焦点并恢复滚动，保留输入且卸载取消恢复任务', async () => {
   const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
   const originalScroll = Object.getOwnPropertyDescriptor(window, 'scrollY')
   const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0, scale: 1 })
   let scroll = 80
   let keyboard!: ReturnType<typeof useKeyboardViewport>
   const host = document.createElement('div'); document.body.append(host)
   vi.useFakeTimers()
   Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
   Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scroll })
   vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 1))
   vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
   const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => { scroll = 0 })
   const app = createApp({ setup() { keyboard = useKeyboardViewport(); return () => h('div', { class: 'app-shell' }, h('input', { value: '保留备注' })) } })
   let mounted = false
   try {
     app.mount(host); mounted = true
     const input = host.querySelector('input')!
     input.focus()
     viewport.height = window.innerHeight - 220
     viewport.dispatchEvent(new Event('resize'))
     await vi.advanceTimersByTimeAsync(2); await nextTick()
     expect(keyboard.keyboardOpen.value).toBe(true)
     viewport.height = window.innerHeight
     viewport.dispatchEvent(new Event('resize'))
     await vi.advanceTimersByTimeAsync(2); await nextTick()
     expect(keyboard.keyboardOpen.value).toBe(false)
     expect(document.activeElement).not.toBe(input)
     expect(input.value).toBe('保留备注')
     expect(scrollTo).toHaveBeenCalledOnce()
     app.unmount(); mounted = false
     await vi.advanceTimersByTimeAsync(400)
     expect(scrollTo).toHaveBeenCalledOnce()
   } finally {
     if (mounted) app.unmount()
     host.remove()
     if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport)
     else Reflect.deleteProperty(window, 'visualViewport')
     if (originalScroll) Object.defineProperty(window, 'scrollY', originalScroll)
     else Reflect.deleteProperty(window, 'scrollY')
     vi.restoreAllMocks(); vi.useRealTimers()
   }
 })
 it('四态互斥，读取失败不被显示为空，重试事件只由用户动作触发', async () => {
   const host = document.createElement('div'); document.body.append(host)
   let retries = 0
   const state = reactive({ status: 'loading' as 'ready'|'loading'|'empty'|'error' })
   const app = createApp({ render: () => h(AppAsyncRegion, { status: state.status, error: { kind: 'unavailable', message:'受控失败夹具', fieldErrors:{}, retryable:true, cause:null }, onRetry: () => retries++ }, { default: () => h('p', { 'data-test-ready': '' }, '受控内容') }) })
   try {
    app.mount(host); await nextTick()
    expect(host.querySelector('.state-block-loading')).not.toBeNull()
    for (const status of ['error','empty','ready'] as const) {
      state.status=status; await nextTick()
      expect(host.querySelector('.state-block-loading')).toBeNull()
      if (status==='ready') expect(host.querySelector('[data-test-ready]')).not.toBeNull()
      else expect(host.querySelector(`[data-test-ready]`)).toBeNull()
      if (status==='error') { expect(host.textContent).toContain('受控失败夹具'); expect(host.querySelector('.state-block-empty')).toBeNull(); host.querySelector('button')?.click(); expect(retries).toBe(1) }
    }
   } finally { app.unmount(); host.remove() }
 })
 it('子层取消保留父子内容，确认放弃只清理指定层', async () => {
   const parent=ref(true), child=ref(true)
   const stopParent=registerUnsavedChanges(parent,()=>{parent.value=false},'parent')
   const stopChild=registerUnsavedChanges(child,()=>{child.value=false},'child')
   try {
    const cancel=requestDiscardChanges('navigation','child'); cancelDiscardChanges(); expect(await cancel).toBe(false)
    expect(parent.value&&child.value).toBe(true)
    const discard=requestDiscardChanges('navigation','child'); await confirmDiscardChanges(); expect(await discard).toBe(true)
    expect(child.value).toBe(false); expect(parent.value).toBe(true)
   } finally { stopParent();stopChild() }
 })
})
