// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ backup: vi.fn(),prepare: vi.fn(),restore: vi.fn(),clear: vi.fn(),
  save: vi.fn(),pick: vi.fn(),discardDb: vi.fn(),discard: vi.fn(),record: vi.fn(),status: vi.fn(),flush: vi.fn() }))
vi.mock('../data/management/dataManagement', () => ({ dataManagement: { backup: state.backup,prepare: state.prepare,restore: state.restore,clear: state.clear } }))
vi.mock('../platform/ledgerTransfers', () => ({ ledgerTransfers: { saveTransfer: state.save,pickBackup: state.pick,discardDatabase: state.discardDb,discardTransfer: state.discard,recordDataResult: state.record,dataStatus: state.status } }))
vi.mock('../platform/draftLifecycle', () => ({ flushDrafts: state.flush }))
vi.mock('../platform/backupLifecycle', () => ({ backupStatus: {} }))
vi.mock('../stores/bootstrap', () => ({ useBootstrapStore: () => ({ datasetId: 'original',replaceDataset: async (work: () => Promise<void>) => work() }) }))
vi.mock('./AppDrawer.vue', () => ({ default: defineComponent({ props: ['open','id'],emits: ['update:open'],setup: (props,{ slots,emit }) => () => h('section',{ 'data-drawer': props.id },[slots.default?.(),h('button',{ onClick: () => emit('update:open',false) },'关闭面板')]) }) }))
vi.mock('./AppDialog.vue', () => ({ default: defineComponent({ props: ['open','confirmLabel'],emits: ['confirm','update:open'],setup: (props,{ emit,slots }) => () => props.open ? h('section',[slots.default?.(),h('button',{ onClick: () => emit('confirm') },props.confirmLabel)]) : null }) }))
import DataManagementActions from './DataManagementActions.vue'
import { dataManagementState } from '../platform/dataManagementState'
let app: App,root: HTMLElement
const button = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.trim()===text)!
async function click(text: string) { button(text).click(); await nextTick() }
async function password() {
  const input = document.querySelector('input[type=password]') as HTMLInputElement
  input.value = 'password1'
  input.dispatchEvent(new Event('input',{ bubbles: true }))
  await nextTick()
}
beforeEach(async () => {
  vi.resetAllMocks()
  for (const method of [state.record,state.discard,state.discardDb,state.flush,state.restore,state.clear]) method.mockResolvedValue(undefined)
  dataManagementState.operationError = undefined
  state.status.mockResolvedValue({ lastResult: '暂无记录',snapshots: 0 })
  state.backup.mockResolvedValue({ id: 'backup-cap' })
  state.save.mockResolvedValue({ saved: false })
  state.pick.mockResolvedValue({ id: 'incoming',cancelled: false })
  state.prepare.mockResolvedValue({ id: 'incoming',name: 'restore_test',manifest: { createdAt: '2026-11-21T01:00:00Z',tables: { ledger_entry: 2 } } })
  root = document.createElement('ul'); document.body.append(root)
  app = createApp(DataManagementActions); app.mount(root); await nextTick()
})
afterEach(async () => { app?.unmount(); await nextTick(); document.body.innerHTML='' })
it('创建后取消保存保留同一备份，清除并隐藏密码，重新保存不再加密也不采用新密码', async () => {
  await click('创建完整备份密码加密')
  await password()
  await click('创建并保存备份')
  await vi.waitFor(() => expect(button('重新保存备份')).toBeDefined())
  expect(state.flush).toHaveBeenCalledWith(true)
  expect(document.querySelector('input[type=password]')).toBeNull()
  await click('重新保存备份')
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledTimes(2))
  expect(state.backup).toHaveBeenCalledOnce()
  expect(state.save.mock.calls.map(call=>call[0].id)).toEqual(['backup-cap','backup-cap'])
  await click('关闭面板')
  expect(state.discard).not.toHaveBeenCalled()
  expect(document.querySelector('input[type=password]')).toBeNull()
  document.querySelector('[data-drawer]')!.dispatchEvent(new Event('close'))
  await vi.waitFor(() => expect(state.discard).toHaveBeenCalledWith({ id: 'backup-cap' }))
})
it('恢复及清理同时失败保留两个原因，错误能由数据集切换后的设置实例承接', async () => {
  await click('从文件恢复整库替换')
  await click('选择备份文件')
  await vi.waitFor(() => expect(document.querySelector('input[type=password]')).not.toBeNull())
  await password(); await click('校验备份')
  await vi.waitFor(() => expect(button('确认恢复范围')).toBeDefined())
  const primary = new Error('controlled-restore'),cleanup = new Error('controlled-cleanup')
  state.restore.mockRejectedValueOnce(primary); state.discardDb.mockRejectedValueOnce(cleanup)
  await click('确认恢复范围'); await click('确认恢复')
  await vi.waitFor(() => expect(dataManagementState.operationError).toBeDefined())
  expect((dataManagementState.operationError!.cause as Error).cause).toMatchObject({ errors: [primary,cleanup] })
})
