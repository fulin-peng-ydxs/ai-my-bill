import type { CreateExpenseRequest, CreateIncomeRequest } from './types'
import { formatShanghaiBusinessDate } from '../../domain/businessTime'
import { calculateExpenseTotal, decimalToScaledInteger, isDecimalInRange, MONEY_MAX, QUANTITY_MAX, scaledIntegerToDecimal, UNIT_PRICE_MAX } from '../../domain/money'
import { normalizedDictionaryName, unicodeCodePointLength } from '../../domain/text'
import { fieldError, requireId } from '../dictionaries/repository'

export function decimal(field: string, value: string, scale: number, maximum: string, positive = false): string {
  if (!isDecimalInRange(value, scale, maximum, positive)) {
    throw fieldError(field, '数值精度或范围无效。')
  }
  return scaledIntegerToDecimal(decimalToScaledInteger(value, scale), scale)
}

function text(field: string, value: unknown, limit: number, required = false): string | undefined {
  if (value != null && typeof value !== 'string') {
    throw fieldError(field, '请输入文本。')
  }
  const normalized = (value as string | undefined)?.trim() || undefined
  if (required && !normalized || normalized && unicodeCodePointLength(normalized) > limit) {
    throw fieldError(field, `内容${required ? '须为 1 至' : '最多'} ${limit} 个字符。`)
  }
  return normalized
}

function occurredAt(value: string, now: Date) {
  // 只接受带明确偏移的真实时刻，拒绝 Date 对非法日期的自动进位。
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  const date = new Date(value)
  if (!match || !Number.isFinite(date.getTime())) {
    throw fieldError('occurredAt', '请选择有效业务时间。')
  }
  const wall = new Date(`${match[1]}T${match[2]}.${(match[3] ?? '').padEnd(3, '0')}Z`)
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 19) !== `${match[1]}T${match[2]}` || date.getTime() > now.getTime() + 300_000) {
    throw fieldError('occurredAt', '业务时间无效或超过当前设备时间 5 分钟。')
  }
  return { occurredAt: date.toISOString(), businessDate: formatShanghaiBusinessDate(date) }
}

export function operationId(value: string): string {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 128) {
    throw fieldError('idempotencyKey', '操作标识须为 1 至 128 个字符。')
  }
  return key
}

export function expectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) {
    throw fieldError('version', '账目版本不合法，请重新加载。')
  }
  return value
}

function reference(id: string, field: string) {
  requireId(id, field)
  return id
}

export function expenseInput(request: CreateExpenseRequest, now: Date) {
  const unitPrice = decimal('unitPrice', request.unitPrice, 4, UNIT_PRICE_MAX)
  const quantity = decimal('quantity', request.quantity, 3, QUANTITY_MAX, true)
  let calculatedAmount: string
  try {
    calculatedAmount = calculateExpenseTotal(unitPrice, quantity)
  } catch {
    throw fieldError('calculatedAmount', '计算金额超出允许范围。')
  }
  return {
    productId: reference(request.productId, 'productId'),
    primaryCategoryId: reference(request.primaryCategoryId, 'primaryCategoryId'),
    secondaryCategoryId: request.secondaryCategoryId == null ? undefined : reference(request.secondaryCategoryId, 'secondaryCategoryId'),
    unitId: reference(request.unitId, 'unitId'), unitPrice, quantity, calculatedAmount,
    paidAmount: decimal('paidAmount', request.paidAmount, 2, MONEY_MAX),
    fundingChannelId: reference(request.fundingChannelId, 'fundingChannelId'),
    purchaseChannelId: request.purchaseChannelId == null ? undefined : reference(request.purchaseChannelId, 'purchaseChannelId'),
    locationLabelId: request.locationLabelId == null ? undefined : reference(request.locationLabelId, 'locationLabelId'),
    ...occurredAt(request.occurredAt, now), note: text('note', request.note, 500),
  }
}

export function incomeInput(request: CreateIncomeRequest, now: Date) {
  const incomeName = text('incomeName', request.incomeName, 200, true)!
  return {
    incomeName, normalizedIncomeName: normalizedDictionaryName(incomeName),
    payerId: reference(request.payerId, 'payerId'), incomeCategoryId: reference(request.incomeCategoryId, 'incomeCategoryId'),
    amount: decimal('amount', request.amount, 2, MONEY_MAX, true),
    fundingChannelId: reference(request.fundingChannelId, 'fundingChannelId'),
    ...occurredAt(request.occurredAt, now), note: text('note', request.note, 500),
  }
}
