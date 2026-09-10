import { describe, expect, it } from 'vitest'

import {
  expenseFormFromResponse, expenseRequestFromForm, incomeFormFromResponse, incomeRequestFromForm,
  validateExpenseForm, validateExpensePaidMinimum, validateIncomeForm,
} from './ledgerEntryForm'

describe('shared ledger entry form rules', () => {
  it('maps an expense detail back through the same request and validation used by create and edit', () => {
    const form = expenseFormFromResponse({ id: 'entry', occurredAt: '2026-09-06T02:30:00Z',
      businessDate: '2026-09-06', productId: 'product', productName: '早餐', primaryCategoryId: 'primary',
      primaryCategoryName: '餐饮', unitId: 'unit', unitName: '份', unitPrice: '6.25', quantity: '2',
      calculatedAmount: '12.50', paidAmount: '12.00', fundingChannelId: 'funding', fundingChannelName: '微信',
      effectiveAdjustmentAmount: '0.00',
      note: '  保留内容  ', createdAt: '2026-09-06T02:30:00Z', updatedAt: '2026-09-06T02:30:00Z', version: 0 })
    expect(validateExpenseForm(form)).toEqual({})
    expect(expenseRequestFromForm(form)).toMatchObject({ paidAmount: '12.00', note: '保留内容',
      occurredAt: '2026-09-06T02:30:00.000Z' })
    form.quantity = '0'
    expect(validateExpenseForm(form).quantity).toContain('大于 0')
  })

  it('rejects an edited paid amount below effective adjustments', () => {
    expect(validateExpensePaidMinimum('4.99', '5.00')).toContain('¥5.00')
    expect(validateExpensePaidMinimum('5.00', '5.00')).toBeUndefined()
    expect(validateExpensePaidMinimum('5.01', '5.00')).toBeUndefined()
  })

  it('maps an income detail and enforces the create rules without an edit-only fork', () => {
    const form = incomeFormFromResponse({ id: 'entry', occurredAt: '2026-09-06T02:30:00Z',
      businessDate: '2026-09-06', incomeName: '奖金', payerId: 'payer', payerName: '公司',
      incomeCategoryId: 'category', incomeCategoryName: '工资', amount: '88.80',
      fundingChannelId: 'funding', fundingChannelName: '银行卡', createdAt: '2026-09-06T02:30:00Z',
      updatedAt: '2026-09-06T02:30:00Z', version: 2 })
    expect(validateIncomeForm(form)).toEqual({})
    expect(incomeRequestFromForm(form)).toMatchObject({ incomeName: '奖金', amount: '88.80' })
    form.amount = '0'
    expect(validateIncomeForm(form).amount).toContain('大于 0')
  })
})
