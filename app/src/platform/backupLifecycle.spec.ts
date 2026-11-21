import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ flush: vi.fn(), daily: vi.fn() }))
vi.mock('./draftLifecycle', () => ({ flushDrafts: state.flush }))
vi.mock('../data/management/dataManagement', () => ({ dataManagement: { daily: state.daily } }))
import { backupStatus, snapshotForeground } from './backupLifecycle'
beforeEach(() => { vi.resetAllMocks(); state.daily.mockResolvedValue(true); backupStatus.error = undefined })
it('前台快照先严格落盘草稿，失败保留提示且不以旧数据创建快照，重试成功清错', async () => {
  state.flush.mockRejectedValueOnce(new Error('controlled-draft'))
  await snapshotForeground(new AbortController().signal)
  expect(state.flush).toHaveBeenCalledWith(true)
  expect(state.daily).not.toHaveBeenCalled()
  expect(backupStatus.error).toBeDefined()
  await snapshotForeground(new AbortController().signal)
  expect(state.daily).toHaveBeenCalledOnce()
  expect(backupStatus.error).toBeUndefined()
})
it('草稿慢写后后台取消不启动快照，也不把取消显示成数据损坏', async () => {
  const controller = new AbortController()
  state.flush.mockImplementationOnce(async () => { controller.abort() })
  await snapshotForeground(controller.signal)
  expect(state.daily).not.toHaveBeenCalled()
  expect(backupStatus.error).toBeUndefined()
})

it('其他管理操作占用时延期，不清除上次未解决的快照错误', async () => {
  state.flush.mockRejectedValueOnce(new Error('controlled-draft'))
  await snapshotForeground(new AbortController().signal)
  const previous = backupStatus.error
  state.daily.mockResolvedValueOnce(false)
  await snapshotForeground(new AbortController().signal)
  expect(backupStatus.error).toBe(previous)
})
