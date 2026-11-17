// @vitest-environment jsdom
import { createApp, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('../data/personal/draftService', () => ({ DraftService: class {
  read = api.read
  save = api.save
} }))
import { useBootstrapStore } from '../stores/bootstrap'
import { useLedgerDraft } from './useLedgerDraft'
import { flushDrafts } from '../platform/draftLifecycle'
import { LocalError } from '../domain/localError'
let cleanup = () => {}
beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  useBootstrapStore().datasetId = 'dataset-a'
  api.read.mockResolvedValue({})
  api.save.mockResolvedValue(undefined)
})
afterEach(async () => {
  cleanup()
  await Promise.resolve()
  vi.useRealTimers()
  vi.clearAllMocks()
})
async function mounted() {
  let draft!: ReturnType<typeof useLedgerDraft>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ setup() {
    draft = useLedgerDraft(ref('EXPENSE'))
    return () => null
  } })
  app.mount(host)
  cleanup = () => {
    app.unmount()
    host.remove()
  }
  await nextTick()
  return draft
}
const settle = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
describe('SQLite 草稿调度', () => {
  it('读取失败的重试只重读，不以空表单覆盖原草稿', async () => {
    api.read.mockRejectedValueOnce(new LocalError('DRAFT_INVALID', '未知草稿版本')).mockResolvedValueOnce({ note: '原草稿' })
    const draft = await mounted()
    await settle()
    expect(draft.storageError.value).toBe('未知草稿版本')
    await draft.retryBackup()
    expect(api.save).not.toHaveBeenCalled()
    expect(draft.data.value.note).toBe('原草稿')
    expect(draft.storageError.value).toBeUndefined()
  })
  it('慢磁盘期间只保留在途写入与最新输入，不排队中间快照', async () => {
    const draft = await mounted()
    await settle()
    let complete!: () => void
    api.save.mockImplementationOnce(() => new Promise<void>(done => { complete = done }))
    await draft.replace({ note: '最初输入' })
    const inFlight = flushDrafts()
    await settle()
    for (let i = 0; i < 20; i++) {
      await draft.replace({ note: `输入${i}` })
      await vi.advanceTimersByTimeAsync(250)
    }
    expect(api.save).toHaveBeenCalledTimes(1)
    complete()
    await inFlight
    expect(api.save.mock.calls.map(call => call[2])).toEqual([{ note: '最初输入' }, { note: '输入19' }])
  })
  it('250ms 合并输入，迟到恢复不能覆盖用户已经开始编辑的值', async () => {
    let resolve!: (value: Record<string, string>) => void
    api.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const draft = await mounted()
    await draft.replace({ note: '新输入' })
    await draft.replace({ note: '最新输入' })
    resolve({ note: '迟到旧草稿' })
    await settle()
    expect(draft.data.value.note).toBe('最新输入')
    expect(draft.restored.value).toBe(true)
    expect(api.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(api.save).toHaveBeenCalledExactlyOnceWith('dataset-a', 'EXPENSE', { note: '最新输入' })
  })
  it('切后台立即落盘；失败保留输入，显式重试后清除旧提示', async () => {
    const draft = await mounted()
    await settle()
    api.save.mockRejectedValueOnce(new Error('受控存储失败'))
    await draft.replace({ paidAmount: '15' })
    await flushDrafts()
    expect(draft.data.value.paidAmount).toBe('15')
    expect(draft.storageError.value).toBe('本地操作未完成，请保留输入后重试。')
    await draft.retryBackup()
    expect(api.save).toHaveBeenCalledTimes(2)
    expect(draft.storageError.value).toBeUndefined()
  })
  it('清除排在已有写入之后，取消防抖；不复活已消费草稿', async () => {
    const draft = await mounted()
    await settle()
    let complete!: () => void
    api.save.mockImplementationOnce(() => new Promise<void>(done => { complete = done }))
    await draft.replace({ note: '已保存账目' })
    const flushing = flushDrafts()
    await settle()
    const clearing = draft.clear()
    complete()
    await Promise.all([flushing, clearing])
    await vi.advanceTimersByTimeAsync(500)
    expect(api.save.mock.calls.map(call => call[2])).toEqual([{ note: '已保存账目' }, {}])
    expect(draft.dirty.value).toBe(false)
  })
  it('数据集切换使旧恢复、防抖和后续编辑失效', async () => {
    let complete!: (value: Record<string, string>) => void
    api.read.mockImplementationOnce(() => new Promise(done => { complete = done }))
    const draft = await mounted()
    await draft.replace({ note: '旧库输入' })
    useBootstrapStore().datasetId = 'dataset-b'
    complete({ note: '旧库回填' })
    await settle()
    await vi.advanceTimersByTimeAsync(500)
    await draft.replace({ note: '错误写入' })
    expect(api.save).not.toHaveBeenCalled()
    expect(draft.data.value).toEqual({})
    expect(draft.restored.value).toBe(false)
  })
  it('提交窗口冻结背景写入；失败后可恢复草稿，成功清除后不再重写', async () => {
    const draft = await mounted()
    await settle()
    await draft.replace({ note: '即将保存' })
    await draft.beginSubmit()
    await flushDrafts()
    expect(api.save).toHaveBeenCalledTimes(1)
    await draft.clear()
    draft.endSubmit()
    await vi.advanceTimersByTimeAsync(500)
    expect(api.save.mock.calls.map(call => call[2])).toEqual([{ note: '即将保存' }, {}])
  })
})
