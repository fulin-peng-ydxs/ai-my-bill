import type { components } from './generated/schema'
import { apiRequest } from './http'
import type { DictionaryType } from '../domain/dictionaries'

export type DictionaryItem = components['schemas']['DictionaryItem']
export type DictionaryPage = components['schemas']['DictionaryPage']
export type DictionaryStatus = components['schemas']['DictionaryStatus']
export type DictionarySummaries = components['schemas']['DictionarySummaries']

export const DICTIONARY_CHANGED_EVENT = 'my-bill:dictionary-changed'

function notifyChanged(type: DictionaryType): void {
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(new CustomEvent(DICTIONARY_CHANGED_EVENT, { detail: { type } }))
  }
}

async function mutate(path: string, type: DictionaryType, init: RequestInit): Promise<DictionaryItem> {
  const item = await apiRequest<DictionaryItem>(path, init)
  notifyChanged(type)
  return item
}

export function listDictionarySummaries(signal?: AbortSignal): Promise<DictionarySummaries> {
  return apiRequest('/dictionaries', { signal })
}

export function listDictionaryItems(
  type: DictionaryType,
  query: string,
  status: DictionaryStatus | '',
  signal?: AbortSignal,
  page = 0,
  size = 100,
): Promise<DictionaryPage> {
  const params = new URLSearchParams({ query, page: String(page), size: String(size) })
  if (status) params.set('status', status)
  return apiRequest(`/dictionaries/${encodeURIComponent(type)}?${params}`, { signal })
}

export function listDictionaryCandidates(
  type: DictionaryType,
  query = '',
  signal?: AbortSignal,
): Promise<DictionaryPage> {
  const params = new URLSearchParams({ query, limit: '50' })
  return apiRequest(`/dictionaries/${encodeURIComponent(type)}/candidates?${params}`, { signal })
}

export function createDictionaryItem(type: DictionaryType, name: string, parentId?: string): Promise<DictionaryItem> {
  return mutate(`/dictionaries/${encodeURIComponent(type)}`, type, {
    method: 'POST',
    body: JSON.stringify({ name, ...(parentId ? { parentId } : {}) }),
  })
}

export function renameDictionaryItem(type: DictionaryType, id: string, name: string): Promise<DictionaryItem> {
  return mutate(`/dictionaries/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, type, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function changeDictionaryItemStatus(
  type: DictionaryType,
  id: string,
  status: DictionaryStatus,
): Promise<DictionaryItem> {
  return mutate(`/dictionaries/${encodeURIComponent(type)}/${encodeURIComponent(id)}/status`, type, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}

export function moveDictionaryItem(type: DictionaryType, id: string, direction: 'UP' | 'DOWN'): Promise<DictionaryItem> {
  return mutate(`/dictionaries/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, type, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  })
}
