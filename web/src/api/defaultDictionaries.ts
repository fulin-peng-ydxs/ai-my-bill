import type { components } from './generated/schema'
import { apiRequest } from './http'

export type DefaultDictionaryType = components['schemas']['DefaultDictionaryType']
export type DefaultDictionaryItem = components['schemas']['DefaultDictionaryItem']
export type DefaultDictionaryPage = components['schemas']['DefaultDictionaryPage']
export type DefaultDictionarySummaries = components['schemas']['DefaultDictionarySummaries']
export type DefaultDictionaryStatus = components['schemas']['DictionaryStatus']

export function listDefaultDictionarySummaries(signal?: AbortSignal): Promise<DefaultDictionarySummaries> {
  return apiRequest('/admin/default-dictionaries', { signal })
}

export function listDefaultDictionaryItems(
  type: DefaultDictionaryType,
  query: string,
  status: DefaultDictionaryStatus | '',
  signal?: AbortSignal,
  page = 0,
  size = 100,
): Promise<DefaultDictionaryPage> {
  const params = new URLSearchParams({ query, page: String(page), size: String(size) })
  if (status) params.set('status', status)
  return apiRequest(`/admin/default-dictionaries/${encodeURIComponent(type)}?${params}`, { signal })
}

export function createDefaultDictionaryItem(
  type: DefaultDictionaryType,
  name: string,
  parentId?: string,
): Promise<DefaultDictionaryItem> {
  return apiRequest(`/admin/default-dictionaries/${encodeURIComponent(type)}`, {
    method: 'POST',
    body: JSON.stringify({ name, ...(parentId ? { parentId } : {}) }),
  })
}

export function changeDefaultDictionaryItemStatus(
  type: DefaultDictionaryType,
  id: string,
  status: DefaultDictionaryStatus,
): Promise<DefaultDictionaryItem> {
  return apiRequest(`/admin/default-dictionaries/${encodeURIComponent(type)}/${encodeURIComponent(id)}/status`, {
    method: 'POST', body: JSON.stringify({ status }),
  })
}

export function moveDefaultDictionaryItem(
  type: DefaultDictionaryType,
  id: string,
  direction: 'UP' | 'DOWN',
  targetId?: string,
): Promise<DefaultDictionaryItem> {
  return apiRequest(`/admin/default-dictionaries/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, {
    method: 'POST', body: JSON.stringify({ direction, ...(targetId ? { targetId } : {}) }),
  })
}
