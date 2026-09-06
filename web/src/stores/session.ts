import { defineStore } from 'pinia'

import { ApiClientError, apiRequest } from '../api/http'
import type { components } from '../api/generated/schema'
import { clearAccountMemory } from '../composables/accountMemory'

export type Session = components['schemas']['SessionResponse']
export type SessionStatus = 'unknown' | 'loading' | 'authenticated' | 'guest' | 'error'

let initialization: Promise<void> | undefined

/** 浏览器唯一会话状态源；页面和路由不得自行解析 Cookie 或复制身份信息。 */
export const useSessionStore = defineStore('session', {
  state: () => ({
    status: 'unknown' as SessionStatus,
    session: undefined as Session | undefined,
    errorMessage: undefined as string | undefined,
  }),
  getters: {
    isAuthenticated: (state) => state.status === 'authenticated' && Boolean(state.session),
  },
  actions: {
    async initialize(force = false): Promise<void> {
      if (!force && (this.status === 'authenticated' || this.status === 'guest')) {
        return
      }
      if (!force && initialization) {
        return initialization
      }
      this.status = 'loading'
      initialization = this.loadSession().finally(() => {
        initialization = undefined
      })
      return initialization
    },
    async loadSession(): Promise<void> {
      try {
        this.session = await apiRequest<Session>('/auth/session')
        this.status = 'authenticated'
        this.errorMessage = undefined
      } catch (error) {
        this.session = undefined
        if (error instanceof ApiClientError && error.status === 401) {
          this.status = 'guest'
          this.errorMessage = undefined
          return
        }
        this.status = 'error'
        this.errorMessage = error instanceof Error ? error.message : '会话检查失败，请稍后重试。'
      }
    },
    async login(username: string, password: string): Promise<Session> {
      if (this.status === 'unknown' || this.status === 'error') {
        await this.initialize(this.status === 'error')
      }
      if (this.isAuthenticated && this.session) {
        return this.session
      }
      const session = await apiRequest<Session>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      this.accept(session)
      return session
    },
    async setFirstPassword(newPassword: string): Promise<Session> {
      const session = await apiRequest<Session>('/auth/first-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      })
      this.accept(session)
      return session
    },
    async changePassword(currentPassword: string, newPassword: string): Promise<Session> {
      const session = await apiRequest<Session>('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      this.accept(session)
      return session
    },
    async logout(): Promise<void> {
      const accountId = this.session?.accountId
      try {
        await apiRequest<void>('/auth/logout', { method: 'POST' })
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          if (accountId) clearAccountMemory(accountId)
          this.clear()
          return
        }
        throw error
      }
      if (accountId) clearAccountMemory(accountId)
      this.clear()
      // 退出后主动请求匿名端点，确保浏览器即使清理过 Cookie 也能继续切换账号。
      await this.initialize(true)
    },
    accept(session: Session): void {
      this.session = session
      this.status = 'authenticated'
      this.errorMessage = undefined
    },
    clear(): void {
      this.session = undefined
      this.status = 'guest'
      this.errorMessage = undefined
    },
  },
})
