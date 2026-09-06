import { describe, expect, it } from 'vitest'

import { defaultDictionaryDefinition, defaultDictionaryDefinitions } from './defaultDictionaries'

describe('default dictionary definitions', () => {
  it('exposes exactly the five future-user catalog types from T9', () => {
    expect(defaultDictionaryDefinitions.map((definition) => definition.type)).toEqual([
      'expense-category',
      'income-category',
      'unit',
      'funding-channel',
      'purchase-channel',
    ])
  })

  it('marks only expense categories as hierarchical and falls back safely', () => {
    expect(defaultDictionaryDefinition('expense-category').hierarchical).toBe(true)
    expect(defaultDictionaryDefinitions.filter((definition) => definition.hierarchical)).toHaveLength(1)
    expect(defaultDictionaryDefinition('unsupported').type).toBe('expense-category')
  })
})
