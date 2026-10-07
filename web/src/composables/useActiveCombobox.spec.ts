import { effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useActiveCombobox } from './useActiveCombobox'

function field() {
  const scope = effectScope()
  const open = ref(false)
  const close = vi.fn(() => { open.value = false })
  scope.run(() => useActiveCombobox(() => open.value, close))
  return { scope, open, close }
}

describe('candidate field ownership', () => {
  it('hands over directly between fields and releases ownership on cancellation', () => {
    const first = field()
    const second = field()
    try {
      first.open.value = true
      second.open.value = true
      expect(first.open.value).toBe(false)
      expect(first.close).toHaveBeenCalledOnce()
      expect(second.open.value).toBe(true)
      second.open.value = false
      first.open.value = true
      expect(second.close).not.toHaveBeenCalled()
    } finally { first.scope.stop(); second.scope.stop() }
  })

  it('does not retain or close an unmounted field when another form opens', () => {
    const old = field()
    old.open.value = true
    old.scope.stop()
    const current = field()
    try {
      current.open.value = true
      expect(old.close).not.toHaveBeenCalled()
    } finally { current.scope.stop() }
  })
})
