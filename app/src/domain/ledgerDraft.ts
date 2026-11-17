import type { EntryType } from './preferences'
import { unicodeCodePointLength } from './text'
import { sanitizeProductSelectionState } from './expenseProductSelection'
import { LocalError } from './localError'

export const DRAFT_SCHEMA = 1
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DRAFT_DEBOUNCE_MS = 250
const limits = {
  EXPENSE: { productId: 36, productName: 200, primaryCategoryId: 36, secondaryCategoryId: 36,
    unitId: 36, unitPrice: 32, quantity: 32, paidAmount: 32, fundingChannelId: 36,
    purchaseChannelId: 36, locationLabelId: 36, occurredAt: 40, note: 500 },
  INCOME: { incomeName: 200, payerId: 36, payerName: 200, incomeCategoryId: 36,
    amount: 32, fundingChannelId: 36, occurredAt: 40, note: 500 },
} as const

/** 编辑中的不完整小数允许保留；只接受类型白名单和有界字符串，不带入状态/账户/正式账目。 */
export function sanitizeDraft(type: EntryType, value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalError('DRAFT_INVALID', '草稿格式不兼容，原内容已保留。')
  }
  const source = value as Record<string, unknown>
  const data: Record<string, string> = {}
  for (const [field, limit] of Object.entries(limits[type])) {
    const text = source[field]
    if (text === undefined || text === '') {
      continue
    }
    if (typeof text !== 'string' || unicodeCodePointLength(text) > limit) {
      throw new LocalError('DRAFT_INVALID', '草稿内容超过允许范围，原内容已保留。')
    }
    data[field] = text
  }
  if (type === 'EXPENSE' && source.productSelectionState) {
    const selection = sanitizeProductSelectionState(source.productSelectionState)
    if (!selection) {
      throw new LocalError('DRAFT_INVALID', '草稿商品状态不兼容，原内容已保留。')
    }
    data.productSelectionState = selection
  }
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 16 * 1024) {
    throw new LocalError('DRAFT_INVALID', '草稿内容过大，原内容已保留。')
  }
  return data
}
