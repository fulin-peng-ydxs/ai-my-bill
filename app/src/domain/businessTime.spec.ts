import { describe, expect, it } from 'vitest'

import {
  formatShanghaiBusinessDate, formatShanghaiDateTime, isShanghaiLocalDateTime,
  shanghaiLocalDateTimeToIso, toShanghaiLocalDateTime,
} from './businessTime'

describe('business time', () => {
  it('converts an instant to a Shanghai datetime-local value', () => {
    expect(toShanghaiLocalDateTime(new Date('2026-01-01T16:05:00Z'))).toBe('2026-01-02T00:05')
  })

  it('interprets datetime-local as Shanghai time and rejects normalized invalid dates', () => {
    expect(shanghaiLocalDateTimeToIso('2026-09-07T08:30')).toBe('2026-09-07T00:30:00.000Z')
    expect(isShanghaiLocalDateTime('2026-02-30T08:30')).toBe(false)
    expect(isShanghaiLocalDateTime('not-a-date')).toBe(false)
  })

  it('formats saved instants in Shanghai rather than the device timezone', () => {
    expect(formatShanghaiDateTime('2026-09-06T16:30:45Z')).toContain('2026/09/07')
    expect(formatShanghaiDateTime('2026-09-06T16:30:45Z')).toContain('00:30:45')
  })

  it('formats export dates by the Shanghai calendar around midnight', () => {
    expect(formatShanghaiBusinessDate(new Date('2026-09-07T15:59:59Z'))).toBe('2026-09-07')
    expect(formatShanghaiBusinessDate(new Date('2026-09-07T16:00:00Z'))).toBe('2026-09-08')
    expect(formatShanghaiBusinessDate(new Date('2026-09-07T23:59:59Z'))).toBe('2026-09-08')
  })
})
