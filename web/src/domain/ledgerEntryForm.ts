import type { CreateExpenseRequest, ExpenseResponse } from '../api/expenses'
import type { CreateIncomeRequest, IncomeResponse } from '../api/incomes'
import { isShanghaiLocalDateTime, shanghaiLocalDateTimeToIso, toShanghaiLocalDateTime } from './businessTime'
import { calculateExpenseTotal, isDecimalInRange, MONEY_MAX, QUANTITY_MAX, UNIT_PRICE_MAX } from './money'
import { unicodeCodePointLength } from './text'

export interface ExpenseFormState {
  productId: string
  productName: string
  primaryCategoryId: string
  secondaryCategoryId: string
  unitId: string
  unitPrice: string
  quantity: string
  paidAmount: string
  fundingChannelId: string
  purchaseChannelId: string
  locationLabelId: string
  occurredAt: string
  note: string
}

export type ExpenseField = keyof ExpenseFormState | 'calculatedAmount'

export interface IncomeFormState {
  incomeName: string
  payerId: string
  payerName: string
  incomeCategoryId: string
  amount: string
  fundingChannelId: string
  occurredAt: string
  note: string
}

export type IncomeField = Exclude<keyof IncomeFormState, 'payerName'>

export function emptyExpenseForm(defaultFundingChannelId?: string | null): ExpenseFormState {
  return {
    productId: '', productName: '', primaryCategoryId: '', secondaryCategoryId: '', unitId: '', unitPrice: '',
    quantity: '1', paidAmount: '', fundingChannelId: defaultFundingChannelId ?? '', purchaseChannelId: '',
    locationLabelId: '', occurredAt: toShanghaiLocalDateTime(), note: '',
  }
}

export function expenseFormFromResponse(value: ExpenseResponse): ExpenseFormState {
  return {
    productId: value.productId, productName: value.productName, primaryCategoryId: value.primaryCategoryId,
    secondaryCategoryId: value.secondaryCategoryId ?? '', unitId: value.unitId, unitPrice: value.unitPrice,
    quantity: value.quantity, paidAmount: value.paidAmount, fundingChannelId: value.fundingChannelId,
    purchaseChannelId: value.purchaseChannelId ?? '', locationLabelId: value.locationLabelId ?? '',
    occurredAt: toShanghaiLocalDateTime(new Date(value.occurredAt)), note: value.note ?? '',
  }
}

export function validateExpenseForm(form: ExpenseFormState): Partial<Record<ExpenseField, string>> {
  const errors: Partial<Record<ExpenseField, string>> = {}
  if (!form.productId) errors.productId = '请选择或新增商品。'
  if (!form.primaryCategoryId) errors.primaryCategoryId = '请选择一级分类。'
  if (!form.unitId) errors.unitId = '请选择单位。'
  if (!isDecimalInRange(form.unitPrice, 4, UNIT_PRICE_MAX)) errors.unitPrice = '单价为 0 至 99,999,999.9999，最多 4 位小数。'
  if (!isDecimalInRange(form.quantity, 3, QUANTITY_MAX, true)) errors.quantity = '数量须大于 0，最多 3 位小数。'
  if (!isDecimalInRange(form.paidAmount, 2, MONEY_MAX)) errors.paidAmount = '实付金额为 0 至 999,999,999.99，最多 2 位小数。'
  if (!form.fundingChannelId) errors.fundingChannelId = '请选择支付方式。'
  if (!isShanghaiLocalDateTime(form.occurredAt)) errors.occurredAt = '请选择有效消费时间。'
  if (unicodeCodePointLength(form.note.trim()) > 500) errors.note = '备注最多 500 个字符。'
  try { calculateExpenseTotal(form.unitPrice, form.quantity) } catch { errors.calculatedAmount = '计算金额超出允许范围。' }
  return errors
}

export function expenseRequestFromForm(form: ExpenseFormState): CreateExpenseRequest {
  return {
    productId: form.productId, primaryCategoryId: form.primaryCategoryId,
    ...(form.secondaryCategoryId ? { secondaryCategoryId: form.secondaryCategoryId } : {}),
    unitId: form.unitId, unitPrice: form.unitPrice, quantity: form.quantity, paidAmount: form.paidAmount,
    fundingChannelId: form.fundingChannelId,
    ...(form.purchaseChannelId ? { purchaseChannelId: form.purchaseChannelId } : {}),
    ...(form.locationLabelId ? { locationLabelId: form.locationLabelId } : {}),
    occurredAt: shanghaiLocalDateTimeToIso(form.occurredAt), ...(form.note.trim() ? { note: form.note.trim() } : {}),
  }
}

export function emptyIncomeForm(defaultFundingChannelId?: string | null): IncomeFormState {
  return { incomeName: '', payerId: '', payerName: '', incomeCategoryId: '', amount: '',
    fundingChannelId: defaultFundingChannelId ?? '', occurredAt: toShanghaiLocalDateTime(), note: '' }
}

export function incomeFormFromResponse(value: IncomeResponse): IncomeFormState {
  return { incomeName: value.incomeName, payerId: value.payerId, payerName: value.payerName,
    incomeCategoryId: value.incomeCategoryId, amount: value.amount, fundingChannelId: value.fundingChannelId,
    occurredAt: toShanghaiLocalDateTime(new Date(value.occurredAt)), note: value.note ?? '' }
}

export function validateIncomeForm(form: IncomeFormState): Partial<Record<IncomeField, string>> {
  const errors: Partial<Record<IncomeField, string>> = {}
  if (!form.incomeName.trim()) errors.incomeName = '请输入收入名称。'
  else if (unicodeCodePointLength(form.incomeName.trim()) > 200) errors.incomeName = '收入名称最多 200 个字符。'
  if (!form.payerId) errors.payerId = '请选择或新增付款方。'
  if (!form.incomeCategoryId) errors.incomeCategoryId = '请选择收入分类。'
  if (!isDecimalInRange(form.amount, 2, MONEY_MAX, true)) errors.amount = '收入金额须大于 0，最多 2 位小数。'
  if (!form.fundingChannelId) errors.fundingChannelId = '请选择收款方式。'
  if (!isShanghaiLocalDateTime(form.occurredAt)) errors.occurredAt = '请选择有效收入时间。'
  if (unicodeCodePointLength(form.note.trim()) > 500) errors.note = '备注最多 500 个字符。'
  return errors
}

export function incomeRequestFromForm(form: IncomeFormState): CreateIncomeRequest {
  return { incomeName: form.incomeName.trim(), payerId: form.payerId, incomeCategoryId: form.incomeCategoryId,
    amount: form.amount, fundingChannelId: form.fundingChannelId, occurredAt: shanghaiLocalDateTimeToIso(form.occurredAt),
    ...(form.note.trim() ? { note: form.note.trim() } : {}) }
}
