// @vitest-environment jsdom
import { createApp, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), finish: vi.fn(),
  background: undefined as ((event: { generation: number }) => Promise<void>) | undefined }))
vi.mock('../data/personal/draftService', () => ({ DraftService: class {
  read = state.read
  save = state.save
} }))
vi.mock('./ledgerFiles', () => ({ ledgerFiles: {
  addListener: async (_event: string, callback: (event: { generation: number }) => Promise<void>) => {
    state.background = callback
    return { remove: async () => {} }
  },
  finishBackground: state.finish,
} }))
import { useBootstrapStore } from '../stores/bootstrap'
import { useLedgerDraft } from '../composables/useLedgerDraft'
import { installDraftLifecycle } from './draftLifecycle'

let cleanup = () => {}
let hidden = false
function observeEvents() {
  return { document: vi.spyOn(document, 'addEventListener'), window: vi.spyOn(window, 'addEventListener') }
}
let events: ReturnType<typeof observeEvents>
async function settle() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  useBootstrapStore().datasetId = 'draft-lifecycle'
  state.read.mockReset().mockResolvedValue({})
  state.save.mockReset().mockResolvedValue(undefined)
  state.finish.mockReset().mockResolvedValue(undefined)
  hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  events = observeEvents()
  installDraftLifecycle()
})
afterEach(async () => {
  cleanup()
  await settle()
  for (const [event, callback] of events.document.mock.calls) {
    document.removeEventListener(event, callback)
  }
  for (const [event, callback] of events.window.mock.calls) {
    window.removeEventListener(event, callback)
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each(['EXPENSE', 'INCOME'] as const)('%s 慢写期间快速切换合并在途写入，同态及旧代次不触发额外失败重试', async type => {
  let draft!: ReturnType<typeof useLedgerDraft>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ setup() {
    draft = useLedgerDraft(ref(type))
    return () => null
  } })
  app.mount(host)
  cleanup = () => {
    app.unmount()
    host.remove()
  }
  await settle()
  let failOld!: (error: Error) => void
  let failLatest!: (error: Error) => void
  state.save.mockImplementationOnce(() => new Promise<void>((_, reject) => { failOld = reject }))
    .mockImplementationOnce(() => new Promise<void>((_, reject) => { failLatest = reject }))
  await draft.replace({ note: '在途旧输入' })
  const first = state.background!({ generation: 1 })
  await settle()
  expect(state.save).toHaveBeenCalledTimes(1)
  hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('pagehide'))
  await draft.replace({ note: '最新输入' })
  const second = state.background!({ generation: 2 })
  const duplicate = state.background!({ generation: 2 })
  await settle()
  expect(state.save).toHaveBeenCalledTimes(1)
  failOld(new Error('controlled-old-write'))
  await settle()
  expect(state.save).toHaveBeenCalledTimes(2)
  failLatest(new Error('controlled-latest-write'))
  await Promise.all([first, second, duplicate])
  await state.background!({ generation: 2 })
  await state.background!({ generation: 1 })
  await vi.advanceTimersByTimeAsync(5000)
  expect(state.save).toHaveBeenCalledTimes(2)
  expect(state.finish.mock.calls).toEqual([[{ generation: 1 }], [{ generation: 2 }]])
  expect(draft.data.value.note).toBe('最新输入')
  expect(draft.storageError.value).toBeDefined()
  await state.background!({ generation: 3 })
  expect(state.save).toHaveBeenCalledTimes(3)
  expect(state.save).toHaveBeenLastCalledWith('draft-lifecycle', type, { note: '最新输入' })
  expect(draft.storageError.value).toBeUndefined()
  expect(state.finish).toHaveBeenLastCalledWith({ generation: 3 })
})
