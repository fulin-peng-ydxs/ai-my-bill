import { expect, it } from 'vitest'
import * as shared from '../../../app/src/domain/money'
import * as legacy from './money'

it('旧 Web 入口消费 App 中同一金额实现，完整领域边界测试随实现迁入 App', () => {
  expect(legacy.calculateExpenseTotal).toBe(shared.calculateExpenseTotal)
  expect(legacy.formatCny).toBe(shared.formatCny)
  expect(legacy.calculateExpenseTotal('12.3456', '1.250')).toBe('15.43')
})
