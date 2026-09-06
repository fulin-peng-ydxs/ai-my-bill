import type { PreferenceRequest, Preferences } from '../domain/preferences'
import { apiRequest } from './http'

export function getPreferences(signal?: AbortSignal): Promise<Preferences> {
  return apiRequest('/preferences', { signal })
}

export function savePreferences(preferences: PreferenceRequest): Promise<Preferences> {
  return apiRequest('/preferences', { method: 'PUT', body: JSON.stringify(preferences) })
}

export function resetPreferences(): Promise<Preferences> {
  return apiRequest('/preferences/reset', { method: 'POST' })
}
