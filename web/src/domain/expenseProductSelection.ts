import type { ProductSuggestion } from '../api/expenses'
import type { ExpenseFormState } from './ledgerEntryForm'
import { calculateExpenseTotal, formatDecimalDisplay } from './money'

const limits = { primaryCategoryId: 36, secondaryCategoryId: 36, unitId: 36, unitPrice: 32,
  quantity: 32, fundingChannelId: 36, purchaseChannelId: 36 } as const
type LinkedField = keyof typeof limits
type Rollback = Partial<Record<LinkedField, { before: string, applied: string }>>
interface SelectionState { version: 1, productId: string, paidManual: boolean, rollback: Rollback }
const categories = ['primaryCategoryId', 'secondaryCategoryId'] as const

/** 来源只包含有界的关联字段，不保存整个表单或通过值相等猜测用户意图。 */
export function sanitizeProductSelectionState(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const source = JSON.parse(value) as Partial<SelectionState>
    if (source?.version !== 1 || typeof source.productId !== 'string' || source.productId.length > 36
      || typeof source.paidManual !== 'boolean' || !source.rollback || typeof source.rollback !== 'object') return undefined
    const rollback: Rollback = {}
    for (const [key, limit] of Object.entries(limits)) {
      const field = key as LinkedField
      const entry = source.rollback[field]
      if (!entry) continue
      if (typeof entry.before !== 'string' || typeof entry.applied !== 'string'
        || entry.before.length > limit || entry.applied.length > limit) return undefined
      rollback[field] = { before: entry.before, applied: entry.applied }
    }
    // 分类回退必须成对，不能还原出没有一级分类的二级分类。
    if (Boolean(rollback.primaryCategoryId) !== Boolean(rollback.secondaryCategoryId)) return undefined
    return JSON.stringify({ version: 1, productId: source.productId, paidManual: source.paidManual, rollback })
  } catch { return undefined }
}

/** 新增、模板和编辑共用：撤回未触碰的自动值，手动值和原账目保持用户所有权。 */
export function createExpenseProductSelection(form: ExpenseFormState) {
  let rollback: Rollback = {}
  let paidManual = Boolean(form.paidAmount)

  function reset(manual = Boolean(form.paidAmount)): void { rollback = {}; paidManual = manual }

  function touch(field: keyof ExpenseFormState): void {
    if (field === 'paidAmount') paidManual = true
    if (field === 'primaryCategoryId' || field === 'secondaryCategoryId') {
      categories.forEach(key => delete rollback[key])
    } else delete rollback[field as LinkedField]
  }

  function recalculate(): void {
    if (paidManual) return
    try {
      const total = calculateExpenseTotal(form.unitPrice, form.quantity)
      form.paidAmount = total === '0.00' ? '' : formatDecimalDisplay(total)
    } catch { form.paidAmount = '' }
  }

  function apply(field: LinkedField, value: string): void {
    rollback[field] = { before: form[field], applied: value }
    form[field] = value
  }

  function withdraw(): void {
    const categoryUntouched = categories.every(key => !rollback[key] || form[key] === rollback[key]?.applied)
    for (const [key, entry] of Object.entries(rollback)) {
      const field = key as LinkedField
      if (entry && form[field] === entry.applied
        && (!categories.includes(field as typeof categories[number]) || categoryUntouched)) form[field] = entry.before
    }
    rollback = {}
  }

  function select(product: ProductSuggestion): void {
    if (form.productId === product.id) { form.productName = product.name; return }
    withdraw()
    form.productId = product.id
    form.productName = product.name
    if (product.primaryCategoryId) {
      apply('primaryCategoryId', product.primaryCategoryId)
      apply('secondaryCategoryId', product.secondaryCategoryId ?? '')
    }
    if (product.unitId) apply('unitId', product.unitId)
    if (product.lastUnitPrice != null && product.lastUnitPrice !== '') apply('unitPrice', formatDecimalDisplay(product.lastUnitPrice))
    if (product.fundingChannelId) apply('fundingChannelId', product.fundingChannelId)
    if (product.purchaseChannelId) apply('purchaseChannelId', product.purchaseChannelId)
    recalculate()
  }

  function clear(): void {
    withdraw()
    form.productId = ''
    form.productName = ''
    recalculate()
  }

  /** 模板整体回填后的商品字段归模板所有，消费场景不随商品撤回。 */
  function template(baseline: ExpenseFormState): void {
    reset(false)
    for (const field of [...categories, 'unitId', 'unitPrice', 'quantity'] as const) {
      rollback[field] = { before: baseline[field], applied: form[field] }
    }
  }

  function serialize(): string {
    return JSON.stringify({ version: 1, productId: form.productId, paidManual, rollback })
  }

  function restore(value: unknown): void {
    reset()
    const safe = sanitizeProductSelectionState(value)
    if (!safe) return
    const state = JSON.parse(safe) as SelectionState
    if (state.productId !== form.productId) return
    paidManual = state.paidManual
    rollback = state.rollback
  }
  return { select, clear, touch, recalculate, reset, template, serialize, restore }
}
