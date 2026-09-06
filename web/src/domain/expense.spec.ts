import { describe, expect, it } from 'vitest'

import { expenseContinuationFields } from './expense'

describe('expense entry rules', () => {
  it('retains only time, funding, purchase channel and location when continuing', () => {
    const retained = expenseContinuationFields({
      occurredAt: '2026-09-06T10:30',
      fundingChannelId: 'funding',
      purchaseChannelId: 'purchase',
      locationLabelId: 'location',
    })

    expect(retained).toEqual({
      occurredAt: '2026-09-06T10:30',
      fundingChannelId: 'funding',
      purchaseChannelId: 'purchase',
      locationLabelId: 'location',
    })
    expect(retained).not.toHaveProperty('productId')
    expect(retained).not.toHaveProperty('quantity')
    expect(retained).not.toHaveProperty('note')
  })
})
