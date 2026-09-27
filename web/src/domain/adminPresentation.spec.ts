import { describe, expect, it } from 'vitest'

import {
  adminActionLabel,
  adminObjectLabel,
  auditChanges,
  formatAdminBytes,
  formatAdminTime,
} from './adminPresentation'

describe('admin presentation', () => {
  it('formats operational values without depending on the browser time zone', () => {
    expect(formatAdminTime('2026-09-27T06:30:00Z')).toContain('14:30')
    expect(formatAdminTime()).toBe('尚无记录')
    expect(formatAdminBytes(1536)).toBe('1.5 KB')
    expect(formatAdminBytes(-1)).toBe('不可用')
  })

  it('maps stable codes and safely flattens changed fields', () => {
    expect(adminActionLabel('CREATE_USER')).toBe('创建用户')
    expect(adminObjectLabel('USER')).toBe('用户账号')
    expect(auditChanges({ changes: {
      status: { before: 'ACTIVE', after: 'DISABLED' },
      metadata: { before: null, after: { count: 2 } },
    } })).toEqual([
      { field: 'status', before: 'ACTIVE', after: 'DISABLED' },
      { field: 'metadata', before: '无', after: '{"count":2}' },
    ])
    expect(auditChanges({ changes: 'invalid' })).toEqual([])
  })
})
