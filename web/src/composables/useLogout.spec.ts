import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from '../api/http'
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
  it('keeps the current session and exposes a nonretryable permission failure', async () => {
    const sessionStore = useSessionStore()
    sessionStore.status = 'authenticated'
    vi.spyOn(sessionStore, 'logout').mockRejectedValue(new ApiClientError(403, {
      code: 'DENIED', message: '退出请求被拒绝', fieldErrors: {}, traceId: 'fixture', retryable: true,
    }))
    const logout = useLogout()
    await logout.logout()
    expect(logout.logoutError.value).toMatchObject({ kind: 'forbidden', retryable: false })
    expect(sessionStore.status).toBe('authenticated')
    expect(replace).not.toHaveBeenCalled()
    expect(logout.loggingOut.value).toBe(false)
  })

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
