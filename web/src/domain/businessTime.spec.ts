import { expect, it } from 'vitest'
import * as shared from '../../../app/src/domain/businessTime'
import * as legacy from './businessTime'

it('旧 Web 入口消费 App 中同一业务时间实现，保留上海业务日期口径', () => {
  expect(legacy.shanghaiLocalDateTimeToIso).toBe(shared.shanghaiLocalDateTimeToIso)
  expect(legacy.formatShanghaiBusinessDate(new Date('2026-01-01T16:05:00Z'))).toBe('2026-01-02')
})
