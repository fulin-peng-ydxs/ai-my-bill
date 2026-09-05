import { describe, expect, it } from 'vitest'

import type { Session } from '../stores/session'
import { postLoginPath } from './navigation'

const user = {
  accountId: '10000000-0000-0000-0000-000000000001',
  username: 'alice',
  role: 'USER',
  passwordChangeRequired: false,
} satisfies Session

const admin = { ...user, role: 'ADMIN' } satisfies Session

describe('post-login navigation', () => {
  it('restores only a registered route allowed for the authenticated role', () => {
    expect(postLoginPath(user, '/ledger?range=today')).toBe('/ledger?range=today')
    expect(postLoginPath(user, '/admin')).toBe('/entry')
    expect(postLoginPath(admin, '/entry')).toBe('/admin')
  })

  it('rejects external and unknown redirect targets', () => {
    expect(postLoginPath(user, '//outside.example')).toBe('/entry')
    expect(postLoginPath(user, '/unknown')).toBe('/entry')
    expect(postLoginPath(user, 'https://outside.example')).toBe('/entry')
  })
})
