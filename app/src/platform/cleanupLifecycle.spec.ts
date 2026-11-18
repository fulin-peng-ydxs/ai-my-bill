// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'
const state = vi.hoisted(() => ({ run: vi.fn(), listeners: new Map<string, () => void>() }))
vi.mock('../data/entries/cleanupService', () => ({ CleanupService: class { run = state.run } }))
vi.mock('../api/localEntries', () => ({ mutateEntry: (operation: () => Promise<unknown>) => operation() }))
vi.mock('./ledgerFiles', () => ({ ledgerFiles: { addListener: async (event: string, callback: () => void) => {
  state.listeners.set(event, callback)
  return { remove: async () => {} }
} } }))
import { useBootstrapStore } from '../stores/bootstrap'
import { cleanupNotice, installCleanupLifecycle } from './cleanupLifecycle'

const success = { status: 'success', deleted: 0, batches: 1, more: false }
let scope: EffectScope
let hidden = false
function observeEvents() {
  return vi.spyOn(document, 'addEventListener')
}
let events: ReturnType<typeof observeEvents>
const settle = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
function start() {
  scope = effectScope()
  scope.run(installCleanupLifecycle)
}
beforeEach(() => {
  setActivePinia(createPinia())
  useBootstrapStore().datasetId = 'a'
  hidden = false
  cleanupNotice.open = false
  cleanupNotice.message = ''
  state.run.mockReset().mockResolvedValue(success)
  state.listeners.clear()
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  events = observeEvents()
})
afterEach(() => {
  scope.stop()
  for (const [event, callback] of events.mock.calls) {
    document.removeEventListener(event, callback)
  }
  vi.restoreAllMocks()
})

it('启动一次，双通道前后台合并，取消中的新前台在结束后执行且不重复重试', async () => {
  const bootstrap = useBootstrapStore()
  bootstrap.status = 'ready'
  state.run.mockResolvedValueOnce({ ...success, status: 'deferred', reason: '尚无时钟观测基线' })
  start()
  await settle()
  expect(state.run).toHaveBeenCalledTimes(1)
  expect(cleanupNotice.message).toContain('尚无时钟观测基线')
  let complete!: (value: unknown) => void
  state.run.mockImplementationOnce(() => new Promise(done => { complete = done }))
  state.listeners.get('background')!()
  state.listeners.get('foreground')!()
  await settle()
  const signal = state.run.mock.calls[1]![1] as AbortSignal
  state.listeners.get('background')!()
  expect(signal.aborted).toBe(true)
  state.listeners.get('foreground')!()
  state.listeners.get('foreground')!()
  complete({ ...success, status: 'cancelled', reason: '已取消' })
  await settle()
  expect(state.run).toHaveBeenCalledTimes(3)
  expect(cleanupNotice.open).toBe(false)
  state.listeners.get('foreground')!()
  document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  expect(state.run).toHaveBeenCalledTimes(3)
})

it.each([true, false])('隐藏安装/后台就绪不启动，原生激活早于 DOM 可见不漏跑：初始就绪=%s', async ready => {
  const bootstrap = useBootstrapStore()
  hidden = true
  bootstrap.status = ready ? 'ready' : 'loading'
  start()
  state.listeners.get('background')!()
  bootstrap.status = 'ready'
  await settle()
  expect(state.run).not.toHaveBeenCalled()
  state.listeners.get('foreground')!()
  await settle()
  expect(state.run).not.toHaveBeenCalled()
  hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  expect(state.run).toHaveBeenCalledTimes(1)
  state.listeners.get('foreground')!()
  document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  expect(state.run).toHaveBeenCalledTimes(1)
})

it('原生后台先于 DOM 隐藏时，就绪通知仍不能启动清理', async () => {
  start()
  state.listeners.get('background')!()
  useBootstrapStore().status = 'ready'
  await settle()
  expect(state.run).not.toHaveBeenCalled()
  state.listeners.get('foreground')!()
  await settle()
  expect(state.run).toHaveBeenCalledTimes(1)
})

it('已排队的前台在结束前再次退后台时，不复活清理', async () => {
  useBootstrapStore().status = 'ready'
  let complete!: (value: unknown) => void
  state.run.mockImplementationOnce(() => new Promise(done => { complete = done }))
  start()
  state.listeners.get('background')!()
  state.listeners.get('foreground')!()
  state.listeners.get('background')!()
  complete({ ...success, status: 'cancelled', reason: '已取消' })
  await settle()
  expect(state.run).toHaveBeenCalledTimes(1)
  state.listeners.get('foreground')!()
  await settle()
  expect(state.run).toHaveBeenCalledTimes(2)
})

it('部分失败提示消费实际进度，重复前台事件不在本轮重试', async () => {
  useBootstrapStore().status = 'ready'
  const reason = '本轮已永久清理 100 条记录；剩余清理未完成，后续回到前台时重新检查。'
  state.run.mockResolvedValueOnce({ ...success, status: 'failed', deleted: 100, more: true, reason })
  start()
  await settle()
  expect(cleanupNotice.open).toBe(true)
  expect(cleanupNotice.message).toBe(reason)
  state.listeners.get('foreground')!()
  document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  expect(state.run).toHaveBeenCalledTimes(1)
  state.listeners.get('background')!()
  state.listeners.get('foreground')!()
  await settle()
  expect(state.run).toHaveBeenCalledTimes(2)
  expect(cleanupNotice.open).toBe(false)
})
