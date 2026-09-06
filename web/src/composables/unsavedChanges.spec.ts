import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import {
  cancelDiscardChanges,
  confirmDiscardChanges,
  hasUnsavedChangesNow,
  registerUnsavedChanges,
  requestDiscardChanges,
} from './unsavedChanges'

describe('unsaved changes coordinator', () => {
  it('cancels a route leave without permanently bypassing the next attempt', async () => {
    const dirty = ref(true)
    const unregister = registerUnsavedChanges(dirty, () => { dirty.value = false })

    const first = requestDiscardChanges('navigation')
    cancelDiscardChanges()
    expect(await first).toBe(false)
    expect(hasUnsavedChangesNow()).toBe(true)

    const second = requestDiscardChanges('navigation')
    await confirmDiscardChanges()
    expect(await second).toBe(true)
    expect(hasUnsavedChangesNow()).toBe(false)
    unregister()
  })

  it('passes logout context so a draft source can preserve device storage', async () => {
    const dirty = ref(true)
    const discard = vi.fn((reason) => {
      expect(reason).toBe('logout')
      dirty.value = false
    })
    const unregister = registerUnsavedChanges(dirty, discard)

    const result = requestDiscardChanges('logout')
    await confirmDiscardChanges()

    expect(await result).toBe(true)
    expect(discard).toHaveBeenCalledOnce()
    unregister()
  })
})
