import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionStore } from '../stores/session'
import { useLogout } from './useLogout'

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  replace.mockReset()
})

describe('useLogout', () => {
  it('ignores repeated logout requests while the first request is pending', async () => {
    let finishLogout: () => void = () => undefined
    const pendingLogout = new Promise<void>((resolve) => {
      finishLogout = resolve
    })
    const sessionStore = useSessionStore()
    const logoutRequest = vi.spyOn(sessionStore, 'logout').mockReturnValue(pendingLogout)
    const logout = useLogout()

    const first = logout.logout()
    const second = logout.logout()
    expect(logout.loggingOut.value).toBe(true)
    expect(logoutRequest).toHaveBeenCalledOnce()

    finishLogout()
    await Promise.all([first, second])

    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/login')
    expect(logout.loggingOut.value).toBe(false)
  })
})
