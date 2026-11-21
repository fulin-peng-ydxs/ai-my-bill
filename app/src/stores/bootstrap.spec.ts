import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ open: vi.fn(), read: vi.fn() }))
vi.mock('../data/ledgerDatabase', () => ({ LedgerDatabase: class {
  open = database.open
  read = database.read
} }))
const preferences = vi.hoisted(() => ({ datasetId: 'old',generation: 1,initialize: vi.fn(async (_id: string) => {}) }))
vi.mock('./preferences', () => ({ usePreferencesStore: () => preferences }))

describe('账本初始化状态入口', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setActivePinia(createPinia())
    database.read.mockResolvedValue('controlled-dataset')
  })

  it('打开完成前保持加载，并发调用合并；成功后不重复打开', async () => {
    let finish!: () => void
    database.open.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const { useBootstrapStore } = await import('./bootstrap')
    const state = useBootstrapStore()
    const first = state.initialize()
    const second = state.initialize()
    expect(state.status).toBe('loading')
    expect(database.open).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([first, second])
    expect(state.status).toBe('ready')
    expect(state.datasetId).toBe('controlled-dataset')
    await state.initialize()
    expect(database.open).toHaveBeenCalledTimes(1)
  })

  it('可恢复失败后明确错误，重试成功清除旧错误；不兼容错误保持不可重试', async () => {
    const { LocalError } = await import('../domain/localError')
    database.open.mockRejectedValueOnce(new LocalError('BUSY', '账本忙，请重试。', { retryable: true }))
      .mockResolvedValueOnce(undefined)
    const { useBootstrapStore } = await import('./bootstrap')
    const state = useBootstrapStore()
    await state.initialize()
    expect(state.status).toBe('error')
    expect(state.datasetId).toBe('')
    expect(state.error?.retryable).toBe(true)
    await state.initialize()
    expect(state.status).toBe('ready')
    expect(state.error).toBeUndefined()

    setActivePinia(createPinia())
    database.open.mockRejectedValueOnce(new LocalError('NEWER_VERSION', '请升级 App。'))
    const incompatible = useBootstrapStore()
    await incompatible.initialize()
    expect(incompatible.status).toBe('error')
    expect(incompatible.error?.retryable).toBe(false)
    expect(database.read).toHaveBeenCalledTimes(1)
  })
  it('切换前同步撤销旧数据集与偏好代次，失败重新挂回实际可用账本并保留失败', async () => {
    database.open.mockResolvedValue(undefined)
    const { useBootstrapStore } = await import('./bootstrap')
    const state = useBootstrapStore()
    await state.initialize()
    const generation = preferences.generation
    await expect(state.replaceDataset(async () => {
      expect(state.status).toBe('loading')
      expect(state.datasetId).toBe('')
      expect(preferences.datasetId).toBe('')
      expect(preferences.generation).toBe(generation+1)
      throw new Error('controlled-switch')
    })).rejects.toThrow('controlled-switch')
    expect(state.status).toBe('ready')
    expect(state.datasetId).toBe('controlled-dataset')
    database.read.mockResolvedValueOnce('new-dataset')
    await state.replaceDataset(async () => {})
    expect(state.datasetId).toBe('new-dataset')
    expect(preferences.initialize).toHaveBeenLastCalledWith('new-dataset')
  })

})
