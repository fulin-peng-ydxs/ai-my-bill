import { describe, expect, it } from 'vitest'

import { dictionaryDefinition, dictionaryDefinitions, normalizeDictionaryName } from './dictionaries'

describe('personal dictionary registry', () => {
  it('defines the eight stable and unique dictionary types', () => {
    expect(dictionaryDefinitions).toHaveLength(8)
    expect(new Set(dictionaryDefinitions.map((item) => item.type)).size).toBe(8)
    expect(dictionaryDefinitions.map((item) => item.type)).toEqual([
      'product', 'expense-category', 'unit', 'funding-channel', 'purchase-channel', 'location',
      'income-category', 'payer',
    ])
  })

  it('keeps income names outside dictionaries and location as a text label', () => {
    expect(dictionaryDefinitions.some((item) => item.type === ('income-name' as never))).toBe(false)
    expect(dictionaryDefinition('location')?.description).toContain('文本标签')
    expect(dictionaryDefinition('funding-channel')?.description).toContain('支付方式')
    expect(dictionaryDefinition('expense-category')?.hierarchical).toBe(true)
  })

  it('normalizes width, whitespace and case like the server uniqueness key', () => {
    expect(normalizeDictionaryName('  Ｃoffee\t  LATTE  ')).toBe('coffee latte')
  })
})
