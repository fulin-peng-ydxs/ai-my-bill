// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import AppAsyncRegion from './AppAsyncRegion.vue'
import { registerUnsavedChanges, requestDiscardChanges, cancelDiscardChanges, confirmDiscardChanges } from '../composables/unsavedChanges'

describe('共享外壳状态和未保存保护', () => {
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
