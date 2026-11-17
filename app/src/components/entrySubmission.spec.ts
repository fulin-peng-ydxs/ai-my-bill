// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExpenseEntryForm from './ExpenseEntryForm.vue'
import IncomeEntryForm from './IncomeEntryForm.vue'
import { LocalError } from '../domain/localError'
import type { ExpenseResponse } from '../api/expenses'
import type { IncomeResponse } from '../api/incomes'

const api = vi.hoisted(() => ({ expense: vi.fn(), income: vi.fn(), latestExpense: vi.fn(), latestIncome: vi.fn() }))
vi.mock('../api/expenses', () => ({ updateExpense: api.expense, getExpense: api.latestExpense, createExpense: vi.fn(),
  listExpenseProducts: vi.fn(async () => ({ items: [] })), undoCreatedExpense: vi.fn() }))
vi.mock('../api/incomes', () => ({ updateIncome: api.income, getIncome: api.latestIncome, createIncome: vi.fn(),
  listRecentIncomeNames: vi.fn(async () => ({ items: [] })), undoCreatedIncome: vi.fn() }))
vi.mock('../api/dictionaries', () => ({ listDictionaryCandidates: vi.fn(async () => ({ items: [] })),
  getDictionaryItem: vi.fn(), createDictionaryItem: vi.fn() }))

const common = { id: 'entry', occurredAt: '2026-11-17T01:00:00.000Z', businessDate: '2026-11-17', fundingChannelId: 'cash',
  fundingChannelName: '现金', createdAt: '2026-11-17T01:00:00.000Z', updatedAt: '2026-11-17T01:00:00.000Z', version: 1 }
const expense: ExpenseResponse = { ...common, productId: 'apple', productName: '苹果', primaryCategoryId: 'fruit', primaryCategoryName: '水果',
  unitId: 'unit', unitName: '斤', unitPrice: '12.3456', quantity: '1.250', calculatedAmount: '15.43', paidAmount: '15.00', effectiveAdjustmentAmount: '0.00' }
const income: IncomeResponse = { ...common, incomeName: '工资', payerId: 'company', payerName: '合成公司', incomeCategoryId: 'salary', incomeCategoryName: '工资', amount: '1000.00' }
let dispose = () => {}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => {
  dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.values(api).forEach(mock => mock.mockReset())
})
async function settle() {
  for (let i = 0; i < 20; i++) {
    await nextTick()
  }
}

async function mount(kind: 'expense' | 'income') {
  const host = document.createElement('div')
  document.body.append(host)
  const component = kind === 'expense' ? ExpenseEntryForm : IncomeEntryForm
  const saved = vi.fn()
  const app = createApp({ render: () => h(component as typeof ExpenseEntryForm, { editEntry: (kind === 'expense' ? expense : income) as ExpenseResponse, onSaved: saved }) })
  dispose = () => {
    app.unmount()
    host.remove()
  }
  app.mount(host)
  await settle()
  const submit = async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
  }
  return { host, submit, saved }
}

describe('原收支表单消费本地错误与版本', () => {
  it('编辑单价重算计算额，保留手动实付', async () => {
    const { host } = await mount('expense')
    const price = host.querySelector<HTMLInputElement>('#expense-unit-price')!
    price.value = '13'
    price.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(host.querySelector<HTMLInputElement>('#expense-paid-amount')!.value).toBe('15')
    expect(host.textContent).toContain('16.25')
  })
  it.each(['expense', 'income'] as const)('%s 字段错误/存储失败保留输入，不发出成功；原内容重试复用操作 ID', async kind => {
    const update = kind === 'expense' ? api.expense : api.income
    update.mockRejectedValueOnce(new LocalError('VALIDATION_FAILED', '字典已停用', { fieldErrors: [{ field: 'fundingChannelId', message: '请选择启用的方式' }] }))
      .mockRejectedValueOnce(new LocalError('LOCAL_DATABASE_FAILED', '本地操作未完成', { retryable: true }))
    const { host, submit, saved } = await mount(kind)
    const field = host.querySelector<HTMLInputElement>(`#${kind}-${kind === 'expense' ? 'paid-amount' : 'amount'}`)!
    await submit()
    expect(host.textContent).toContain('请选择启用的方式')
    expect(field.value).toBe(kind === 'expense' ? '15' : '1000')
    await submit()
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0]![2]).toBe(update.mock.calls[1]![2])
    expect(saved).not.toHaveBeenCalled()
  })
  it.each(['expense', 'income'] as const)('%s 冲突后保留输入重新确认，版本变化生成新操作 ID', async kind => {
    const update = kind === 'expense' ? api.expense : api.income
    const latest = kind === 'expense' ? api.latestExpense : api.latestIncome
    const value = kind === 'expense' ? expense : income
    update.mockRejectedValueOnce(new LocalError('LEDGER_VERSION_CONFLICT', '账目已变化')).mockResolvedValue({ ...value, version: 3 })
    latest.mockResolvedValue({ ...value, version: 2 })
    const { host, submit, saved } = await mount(kind)
    await submit()
    expect(host.querySelector('.edit-conflict')).not.toBeNull()
    const retain = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '保留输入并重新确认')!
    retain.click()
    await settle()
    expect(saved).not.toHaveBeenCalled()
    await submit()
    expect(update.mock.calls[1]![1].version).toBe(2)
    expect(update.mock.calls[1]![2]).not.toBe(update.mock.calls[0]![2])
    expect(saved).toHaveBeenCalledTimes(1)
  })
})
