import { defineStore } from 'pinia'
import { normalizeRequestError, type RequestError } from '../api/errors'

import { getPreferences, resetPreferences, savePreferences } from '../api/preferences'
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  type PreferenceRequest,
} from '../domain/preferences'
import { readAccountStorage, removeAccountStorage, writeAccountStorage } from '../storage/accountStorage'
import { useThemeStore } from './theme'

export type PreferenceField = keyof PreferenceRequest
export type PreferenceSaveState = 'idle' | 'saving' | 'error'

const queues = new WeakMap<object, Promise<void>>()

function localTheme(value: PreferenceRequest['themeMode']): 'system' | 'light' | 'dark' {
  return value.toLowerCase() as 'system' | 'light' | 'dark'
}

/** 登录态偏好的唯一状态源；服务端权威，本地账号命名空间只用于安全回退。 */
export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    accountId: undefined as string | undefined,
    values: { ...DEFAULT_PREFERENCES } as PreferenceRequest,
    confirmedValues: { ...DEFAULT_PREFERENCES } as PreferenceRequest,
    defaultFundingChannelName: undefined as string | undefined,
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    fieldStates: {} as Partial<Record<PreferenceField, PreferenceSaveState>>,
    errorMessage: undefined as string | undefined,
    requestError: undefined as RequestError | undefined,
    revision: 0,
  }),
  getters: {
    isSaving: (state) => Object.values(state.fieldStates).some((value) => value === 'saving'),
  },
  actions: {
    async initialize(accountId: string): Promise<void> {
      const requestRevision = ++this.revision
      this.accountId = accountId
      this.status = 'loading'
      this.errorMessage = undefined
      this.requestError = undefined
      const cached = await readAccountStorage(accountId, 'preferences')
      if (requestRevision !== this.revision || this.accountId !== accountId) return
      if (cached) {
        try {
          this.apply(JSON.parse(cached))
        } catch {
          await removeAccountStorage(accountId, 'preferences')
        }
      }
      try {
        const response = await getPreferences()
        if (requestRevision !== this.revision || this.accountId !== accountId) return
        this.apply(response)
        this.status = 'ready'
        await this.cache()
      } catch (error) {
        if (requestRevision !== this.revision || this.accountId !== accountId) return
        this.status = 'error'
        this.requestError = normalizeRequestError(error)
        this.errorMessage = error instanceof Error ? error.message : '偏好加载失败，已使用安全默认值。'
      }
    },
    async update(patch: Partial<PreferenceRequest>): Promise<void> {
      if (!this.accountId || this.isSaving) return
      const requestAccountId = this.accountId
      const fields = Object.keys(patch) as PreferenceField[]
      if (fields.length === 0) return
      this.values = normalizePreferences({ ...this.values, ...patch })
      fields.forEach((field) => { this.fieldStates[field] = 'saving' })
      this.errorMessage = undefined
      this.requestError = undefined
      this.applyTheme()
      const requestedRevision = ++this.revision
      const previous = queues.get(this) ?? Promise.resolve()
      const operation = previous.catch(() => undefined).then(async () => {
        const snapshot = { ...this.values }
        try {
          const response = await savePreferences(snapshot)
          if (this.accountId !== requestAccountId || requestedRevision !== this.revision) return
          this.apply(response)
          fields.forEach((field) => { this.fieldStates[field] = 'idle' })
          this.status = 'ready'
          await this.cache()
        } catch (error) {
          if (this.accountId === requestAccountId && requestedRevision === this.revision) {
            fields.forEach((field) => { this.fieldStates[field] = 'error' })
            this.requestError = normalizeRequestError(error)
            this.errorMessage = error instanceof Error ? error.message : '偏好保存失败，当前选择已保留。'
          }
          throw error
        }
      })
      queues.set(this, operation)
      return operation
    },
    async reset(): Promise<void> {
      if (!this.accountId || this.isSaving) return
      const requestAccountId = this.accountId
      const requestedRevision = ++this.revision
      const before = { ...this.values }
      this.values = { ...DEFAULT_PREFERENCES }
      const fields = Object.keys(DEFAULT_PREFERENCES) as PreferenceField[]
      fields.forEach((field) => { this.fieldStates[field] = 'saving' })
      this.applyTheme()
      try {
        const response = await resetPreferences()
        if (this.accountId !== requestAccountId || requestedRevision !== this.revision) return
        this.apply(response)
        fields.forEach((field) => { this.fieldStates[field] = 'idle' })
        this.status = 'ready'
        this.errorMessage = undefined
        this.requestError = undefined
        await this.cache()
      } catch (error) {
        if (this.accountId === requestAccountId && requestedRevision === this.revision) {
          this.values = before
          this.applyTheme()
          fields.forEach((field) => { this.fieldStates[field] = 'error' })
          this.requestError = normalizeRequestError(error)
          this.errorMessage = error instanceof Error ? error.message : '恢复默认失败，原偏好保持不变。'
        }
        throw error
      }
    },
    retry(field: PreferenceField): Promise<void> {
      return this.update({ [field]: this.values[field] })
    },
    apply(value: unknown): void {
      const candidate = value && typeof value === 'object'
        ? value as { defaultFundingChannelName?: unknown }
        : undefined
      this.defaultFundingChannelName = typeof candidate?.defaultFundingChannelName === 'string'
        ? candidate.defaultFundingChannelName
        : undefined
      this.values = normalizePreferences(value)
      this.confirmedValues = { ...this.values }
      this.applyTheme()
    },
    applyTheme(): void {
      useThemeStore().setMode(localTheme(this.values.themeMode))
    },
    async cache(): Promise<void> {
      if (!this.accountId) return
      await writeAccountStorage(this.accountId, 'preferences', JSON.stringify({
        ...this.values,
        ...(this.defaultFundingChannelName ? { defaultFundingChannelName: this.defaultFundingChannelName } : {}),
      }))
    },
    clearMemory(): void {
      this.revision += 1
      this.accountId = undefined
      this.values = { ...DEFAULT_PREFERENCES }
      this.confirmedValues = { ...DEFAULT_PREFERENCES }
      this.defaultFundingChannelName = undefined
      this.status = 'idle'
      this.fieldStates = {}
      this.errorMessage = undefined
      this.requestError = undefined
    },
    discardPending(): void {
      this.values = { ...this.confirmedValues }
      this.fieldStates = {}
      this.errorMessage = undefined
      this.requestError = undefined
      this.applyTheme()
    },
  },
})
