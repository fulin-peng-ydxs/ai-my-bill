// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
const state = vi.hoisted(() => ({ run: vi.fn(), listeners: new Map<string, () => void>() }))
vi.mock('../data/entries/cleanupService', () => ({ CleanupService: class { run = state.run } }))
vi.mock('../api/localEntries', () => ({ mutateEntry: (operation: () => Promise<unknown>) => operation() }))
vi.mock('./ledgerFiles', () => ({ ledgerFiles: { addListener: async (event: string, callback: () => void) => {
  state.listeners.set(event, callback); return { remove: async () => {} }
} } }))
import { useBootstrapStore } from '../stores/bootstrap'
import { cleanupNotice, installCleanupLifecycle } from './cleanupLifecycle'
it('启动一次，双通道前后台合并，取消中的新前台在结束后执行且不重复重试', async () => {
  setActivePinia(createPinia())
  const bootstrap = useBootstrapStore()
  bootstrap.status = 'ready'; bootstrap.datasetId = 'a'
  const success = { status: 'success', deleted: 0, batches: 1, more: false }
  state.run.mockResolvedValueOnce({ ...success, status: 'deferred', reason: '尚无时钟观测基线' })
  installCleanupLifecycle()
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick() } }
  await settle()
  expect(state.run).toHaveBeenCalledTimes(1)
  expect(cleanupNotice.message).toContain('尚无时钟观测基线')
  let complete!: (value: unknown) => void
  state.run.mockImplementationOnce(() => new Promise(done => { complete = done })).mockResolvedValueOnce(success)
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
