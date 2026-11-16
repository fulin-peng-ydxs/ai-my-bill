import type { components } from './generated/schema'
import { apiRequest } from './http'
import type { DictionaryType } from '../domain/dictionaries'

export type DictionaryItem = components['schemas']['DictionaryItem']
export type DictionaryPage = components['schemas']['DictionaryPage']
export type DictionaryStatus = components['schemas']['DictionaryStatus']
export type DictionarySummaries = components['schemas']['DictionarySummaries']
export type ProductMergePreview = components['schemas']['ProductMergePreview']
export type ProductMergeResult = components['schemas']['ProductMergeResult']

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
  hierarchy: { parentId?: string, rootsOnly?: boolean } = {},
): Promise<DictionaryPage> {
  const params = new URLSearchParams({ query, page: String(page), size: String(size) })
  if (status) params.set('status', status)
  if (hierarchy.parentId) params.set('parentId', hierarchy.parentId)
  if (hierarchy.rootsOnly) params.set('rootsOnly', 'true')
  return apiRequest(`/dictionaries/${encodeURIComponent(type)}?${params}`, { signal })
}

/** 历史筛选按 ID 回显，包括停用项；本地业务服务接入时保留这一语义。 */
export function getDictionaryItem(type: DictionaryType, id: string, signal?: AbortSignal): Promise<DictionaryItem> {
  return apiRequest(`/dictionaries/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { signal })
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

export function moveDictionaryItem(type: DictionaryType, id: string, direction: 'UP' | 'DOWN', targetId?: string): Promise<DictionaryItem> {
  return mutate(`/dictionaries/${encodeURIComponent(type)}/${encodeURIComponent(id)}/move`, type, {
    method: 'POST',
    body: JSON.stringify({ direction, ...(targetId ? { targetId } : {}) }),
  })
}

export function previewProductMerge(sourceProductId: string, targetProductId: string): Promise<ProductMergePreview> {
  const params = new URLSearchParams({ targetProductId })
  return apiRequest(`/dictionaries/product/${encodeURIComponent(sourceProductId)}/merge-preview?${params}`)
}

export async function mergeProduct(sourceProductId: string, targetProductId: string): Promise<ProductMergeResult> {
  const result = await apiRequest<ProductMergeResult>(
    `/dictionaries/product/${encodeURIComponent(sourceProductId)}/merge`,
    { method: 'POST', body: JSON.stringify({ targetProductId }) },
  )
  notifyChanged('product')
  return result
}
