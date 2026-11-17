import { defineStore } from 'pinia'
import { normalizeRequestError, type RequestError } from '../api/errors'
import { getPreferences, savePreferences, resetPreferences } from '../api/preferences'
import { DEFAULT_PREFERENCES, normalizePreferences, type PreferenceRequest, type Preferences } from '../domain/preferences'
import { useThemeStore } from './theme'

export type PreferenceField = keyof PreferenceRequest
type SaveState = 'idle' | 'saving' | 'error'
const queues = new WeakMap<object, Promise<void>>()

/** SQLite 是唯一持久化来源；乐观选择与确认值分开，按字段代次接纳结果。 */
export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    datasetId: '',
    values: { ...DEFAULT_PREFERENCES } as PreferenceRequest,
    confirmedValues: { ...DEFAULT_PREFERENCES } as PreferenceRequest,
    defaultFundingChannelName: undefined as string | undefined,
    status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
    fieldStates: {} as Partial<Record<PreferenceField, SaveState>>,
    fieldRevisions: {} as Partial<Record<PreferenceField, number>>,
    generation: 0,
    errorMessage: undefined as string | undefined,
    requestError: undefined as RequestError | undefined,
  }),
  getters: {
    isSaving: state => Object.values(state.fieldStates).some(value => value === 'saving'),
  },
  actions: {
    async initialize(datasetId: string) {
      const generation = ++this.generation
      this.datasetId = datasetId
      this.values = { ...DEFAULT_PREFERENCES }
      this.confirmedValues = { ...DEFAULT_PREFERENCES }
      this.fieldStates = {}
      this.fieldRevisions = {}
      this.status = 'loading'
      this.errorMessage = undefined
      this.requestError = undefined
      try {
        const response = await getPreferences(datasetId)
        if (this.generation !== generation || this.datasetId !== datasetId) {
          return
        }
        this.apply(response)
        this.status = 'ready'
      } catch (error) {
        if (this.generation !== generation || this.datasetId !== datasetId) {
          return
        }
        this.status = 'error'
        this.fail(error)
        this.applyTheme()
      }
    },
    update(patch: Partial<PreferenceRequest>): Promise<void> {
      const dataset = this.datasetId
      const generation = this.generation
      if (!dataset) {
        return Promise.reject(new Error('账本尚未就绪。'))
      }
      const fields = Object.keys(patch) as PreferenceField[]
      const revisions = Object.fromEntries(fields.map(field => [field, (this.fieldRevisions[field] ?? 0) + 1]))
      fields.forEach(field => {
        this.fieldRevisions[field] = revisions[field]
        this.fieldStates[field] = 'saving'
      })
      this.values = normalizePreferences({ ...this.values, ...patch })
      this.applyTheme()
      const operation = (queues.get(this) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        try {
          const response = await savePreferences(dataset, patch)
          if (generation !== this.generation || dataset !== this.datasetId) {
            return
          }
          for (const field of fields) {
            // 返回整组偏好也只能确认本次字段，不能覆盖随后排队的选择或另一字段的失败输入。
            Object.assign(this.confirmedValues, { [field]: response[field] })
            if (this.fieldRevisions[field] === revisions[field]) {
              Object.assign(this.values, { [field]: response[field] })
              this.fieldStates[field] = 'idle'
            }
          }
          this.defaultFundingChannelName = response.defaultFundingChannelName
          for (const field of Object.keys(DEFAULT_PREFERENCES) as PreferenceField[]) {
            if (!fields.includes(field) && !['saving', 'error'].includes(this.fieldStates[field] ?? 'idle')) {
              // 首次读取曾失败时，后续成功返回的完整 SQLite 状态恢复其他未编辑字段。
              Object.assign(this.values, { [field]: response[field] })
              Object.assign(this.confirmedValues, { [field]: response[field] })
            }
          }
          this.status = 'ready'
          if (!Object.values(this.fieldStates).includes('error')) {
            this.errorMessage = undefined
            this.requestError = undefined
          }
          this.applyTheme()
        } catch (error) {
          if (generation === this.generation && dataset === this.datasetId) {
            fields.forEach(field => {
              if (this.fieldRevisions[field] === revisions[field]) {
                this.fieldStates[field] = 'error'
              }
            })
            this.fail(error)
          }
          throw error
        }
      })
      queues.set(this, operation)
      return operation
    },
    async reset() {
      const dataset = this.datasetId
      const generation = this.generation
      if (!dataset || this.isSaving) {
        return
      }
      const before = { ...this.values }
      const fields = Object.keys(DEFAULT_PREFERENCES) as PreferenceField[]
      fields.forEach(field => { this.fieldStates[field] = 'saving' })
      try {
        const response = await resetPreferences(dataset)
        if (generation !== this.generation || dataset !== this.datasetId) {
          return
        }
        this.apply(response)
        this.status = 'ready'
      } catch (error) {
        if (generation === this.generation && dataset === this.datasetId) {
          this.values = before
          fields.forEach(field => { this.fieldStates[field] = 'error' })
          this.fail(error)
          this.applyTheme()
        }
        throw error
      }
    },
    retry(field?: PreferenceField) {
      return field ? this.update({ [field]: this.values[field] }) : this.initialize(this.datasetId)
    },
    apply(value: Preferences) {
      this.values = normalizePreferences(value)
      this.confirmedValues = { ...this.values }
      this.defaultFundingChannelName = value.defaultFundingChannelName
      this.fieldStates = {}
      this.errorMessage = undefined
      this.requestError = undefined
      this.applyTheme()
    },
    applyTheme() {
      useThemeStore().setMode(this.values.themeMode.toLowerCase() as 'system' | 'light' | 'dark')
    },
    fail(error: unknown) {
      this.requestError = normalizeRequestError(error)
      this.errorMessage = this.requestError.message
    },
  },
})
