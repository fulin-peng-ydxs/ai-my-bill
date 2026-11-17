import { effectScope, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useTemplateDelivery } from './useTemplateDelivery'

describe('模板延迟投递保护', () => {
  it('显式选择可替换旧输入，等待恢复期间的新输入优先；重新选择可重新投递', () => {
    const scope = effectScope()
    const selected = ref(0)
    const edits = ref(3)
    const accepts = scope.run(() => useTemplateDelivery(() => selected.value, edits))!
    selected.value = 1
    expect(accepts()).toBe(true)
    edits.value += 1
    expect(accepts()).toBe(false)
    selected.value = 2
    expect(accepts()).toBe(true)
    scope.stop()
  })
})
