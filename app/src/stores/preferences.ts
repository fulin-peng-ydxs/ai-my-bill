import type { RequestError } from '../api/errors'
import { defineStore } from 'pinia'
import { DEFAULT_PREFERENCES, type PreferenceRequest } from '../domain/preferences'

/** T4 页面缓存的运行期选择；不声称已经保存偏好，持久化在 T7 接入。 */
export type PreferenceField = keyof PreferenceRequest
export const usePreferencesStore = defineStore('preferences', {
  state: () => ({ values: { ...DEFAULT_PREFERENCES }, status: 'ready', isSaving: false, fieldStates: {} as Record<string,string>, errorMessage: undefined as string|undefined, requestError: undefined as RequestError|undefined }),
  actions: { async retry(_field: string) { throw new Error('当前版本暂不支持保存偏好。') }, async update(patch: Partial<PreferenceRequest>) { Object.assign(this.values, patch) } },
})
