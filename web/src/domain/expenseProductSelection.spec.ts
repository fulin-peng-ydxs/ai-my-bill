import { describe, expect, it } from 'vitest'
import { emptyExpenseForm } from './ledgerEntryForm'
import { createExpenseProductSelection, sanitizeProductSelectionState } from './expenseProductSelection'

const product = { id: 'product-a', name: '怡宝', primaryCategoryId: 'drink', secondaryCategoryId: 'water',
  unitId: 'bottle', lastUnitPrice: '2.00', fundingChannelId: 'cash', purchaseChannelId: 'store' }
function setup() {
  const form = emptyExpenseForm('wechat')
  const selection = createExpenseProductSelection(form)
  return { form, selection }
}

describe('expense product ownership', () => {
  it('withdraws untouched defaults and derived amount while retaining the consumption scene', () => {
    const { form, selection } = setup()
    form.note = '带回家'
    form.locationLabelId = 'home'
    const occurredAt = form.occurredAt
    selection.select(product)
    expect(form.paidAmount).toBe('2')
    selection.clear()
    expect(form).toMatchObject({ productId: '', productName: '', primaryCategoryId: '', secondaryCategoryId: '',
      unitId: '', unitPrice: '', quantity: '1', paidAmount: '', fundingChannelId: 'wechat', purchaseChannelId: '',
      locationLabelId: 'home', note: '带回家', occurredAt })
  })

  it('restores pre-selection values rather than replacing them with empty defaults', () => {
    const { form, selection } = setup()
    Object.assign(form, { primaryCategoryId: 'food', secondaryCategoryId: 'fruit', unitId: 'kg', unitPrice: '6', purchaseChannelId: 'market' })
    selection.select(product)
    selection.clear()
    expect(form).toMatchObject({ primaryCategoryId: 'food', secondaryCategoryId: 'fruit', unitId: 'kg', unitPrice: '6', paidAmount: '6', purchaseChannelId: 'market' })
  })

  it('protects explicit manual decisions even when the final value equals the auto-filled value', () => {
    const { form, selection } = setup()
    selection.select(product)
    selection.touch('unitPrice')
    selection.touch('fundingChannelId')
    selection.clear()
    expect(form.unitPrice).toBe('2')
    expect(form.paidAmount).toBe('2')
    expect(form.fundingChannelId).toBe('cash')
  })

  it('keeps category pairs intact after either category is edited', () => {
    const { form, selection } = setup()
    selection.select(product)
    form.secondaryCategoryId = 'juice'
    selection.touch('secondaryCategoryId')
    selection.clear()
    expect([form.primaryCategoryId, form.secondaryCategoryId]).toEqual(['drink', 'juice'])
  })

  it('recalculates automatic paid amount using the retained manual price and quantity', () => {
    const { form, selection } = setup()
    selection.select(product)
    form.unitPrice = '3'
    selection.touch('unitPrice')
    form.quantity = '2'
    selection.touch('quantity')
    selection.recalculate()
    selection.clear()
    expect([form.unitPrice, form.quantity, form.paidAmount]).toEqual(['3', '2', '6'])
  })

  it('retains a manually entered paid amount across selection, quantity changes and clearing', () => {
    const { form, selection } = setup()
    form.paidAmount = '1.8'
    selection.touch('paidAmount')
    selection.select(product)
    form.quantity = '4'
    selection.touch('quantity')
    selection.recalculate()
    selection.clear()
    expect(form.paidAmount).toBe('1.8')
  })

  it('does not overwrite manual inputs when reselecting the same product', () => {
    const { form, selection } = setup()
    selection.select(product)
    form.unitPrice = '9'
    selection.touch('unitPrice')
    form.paidAmount = '8.5'
    selection.touch('paidAmount')
    selection.select({ ...product, name: '怡宝新名称', lastUnitPrice: '100' })
    expect([form.unitPrice, form.paidAmount]).toEqual(['9', '8.5'])
    expect(form.productName).toBe('怡宝新名称')
  })

  it('removes the previous product defaults before selecting another product or a newly created one', () => {
    const { form, selection } = setup()
    form.unitPrice = '5'
    selection.select(product)
    selection.select({ id: 'product-b', name: '新商品', unitId: 'piece' })
    expect(form).toMatchObject({ primaryCategoryId: '', secondaryCategoryId: '', unitId: 'piece', unitPrice: '5',
      fundingChannelId: 'wechat', purchaseChannelId: '', paidAmount: '5' })
    selection.clear()
    expect(form.unitId).toBe('')
    expect(form.unitPrice).toBe('5')
  })

  it('keeps existing fields when the new product has no default values', () => {
    const { form, selection } = setup()
    Object.assign(form, { primaryCategoryId: 'food', unitId: 'kg', unitPrice: '8', paidAmount: '7' })
    selection.touch('paidAmount')
    selection.select({ id: 'new', name: '新商品' })
    selection.clear()
    expect(form).toMatchObject({ primaryCategoryId: 'food', unitId: 'kg', unitPrice: '8', paidAmount: '7' })
  })

  it('clears only the product on an original edited entry and undoes only later automatic replacements', () => {
    const { form, selection } = setup()
    Object.assign(form, { productId: 'original', productName: '原商品', primaryCategoryId: 'food', unitPrice: '6', paidAmount: '5.8' })
    selection.reset(true)
    selection.select(product)
    selection.clear()
    expect(form).toMatchObject({ productId: '', primaryCategoryId: 'food', unitPrice: '6', paidAmount: '5.8' })
  })

  it('withdraws template product fields but retains template consumption scene and manual payment', () => {
    const { form, selection } = setup()
    const baseline = { ...form }
    Object.assign(form, { productId: product.id, productName: product.name, primaryCategoryId: 'drink',
      secondaryCategoryId: 'water', unitId: 'bottle', unitPrice: '2', quantity: '6', paidAmount: '10',
      fundingChannelId: 'cash', purchaseChannelId: 'store', locationLabelId: 'home' })
    selection.template(baseline)
    selection.select(product)
    expect(form.paidAmount).toBe('10')
    form.paidAmount = '9.8'
    selection.touch('paidAmount')
    selection.clear()
    expect(form).toMatchObject({ unitPrice: '', quantity: '1', paidAmount: '9.8', primaryCategoryId: '',
      unitId: '', fundingChannelId: 'cash', purchaseChannelId: 'store', locationLabelId: 'home' })
  })

  it('restores ownership through drafts, including protection of manual values', () => {
    const { form, selection } = setup()
    selection.select(product)
    selection.touch('fundingChannelId')
    form.paidAmount = '1.8'
    selection.touch('paidAmount')
    const restoredForm = { ...form }
    const restoredSelection = createExpenseProductSelection(restoredForm)
    restoredSelection.restore(selection.serialize())
    restoredSelection.clear()
    expect(restoredForm).toMatchObject({ unitPrice: '', paidAmount: '1.8', fundingChannelId: 'cash', primaryCategoryId: '' })
  })

  it('protects legacy drafts, malformed metadata and metadata belonging to another product', () => {
    const { form, selection } = setup()
    selection.select(product)
    const state = selection.serialize()
    form.productId = 'other'
    for (const value of [undefined, '{', state]) {
      selection.restore(value)
      selection.clear()
      expect(form.unitPrice).toBe('2')
      expect(form.paidAmount).toBe('2')
    }
  })

  it('bounds and whitelists persisted ownership and rejects half-category rollback', () => {
    expect(sanitizeProductSelectionState(JSON.stringify({ version: 1, productId: 'p', paidManual: false,
      rollback: { token: { before: 'secret', applied: 'secret' }, unitId: { before: '', applied: 'bottle', token: 'secret' } } })))
      .toBe(JSON.stringify({ version: 1, productId: 'p', paidManual: false, rollback: { unitId: { before: '', applied: 'bottle' } } }))
    expect(sanitizeProductSelectionState(JSON.stringify({ version: 1, productId: 'p', paidManual: false,
      rollback: { primaryCategoryId: { before: '', applied: 'drink' } } }))).toBeUndefined()
    expect(sanitizeProductSelectionState('x'.repeat(4097))).toBeUndefined()
  })
})
