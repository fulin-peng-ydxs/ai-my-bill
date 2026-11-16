import { appDatabase } from '../data/appDatabase'
import { DictionaryService } from '../data/dictionaries/dictionaryService'
import { ProductService } from '../data/dictionaries/productService'
import { localOperation } from '../data/localOperation'
import type { DictionaryItem, DictionaryStatus, DictionaryType } from '../data/dictionaries/types'
export type { DictionaryItem, DictionaryPage, DictionaryStatus, DictionarySummaries, ProductMergePreview, ProductMergeResult } from '../data/dictionaries/types'

const dictionaries = new DictionaryService(appDatabase)
const products = new ProductService(appDatabase)
export const DICTIONARY_CHANGED_EVENT = 'my-bill:dictionary-changed'

function notifyChanged(type: DictionaryType): void {
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(new CustomEvent(DICTIONARY_CHANGED_EVENT, { detail: { type } }))
  }
}

/** 只在 SQLite 已提交后广播；失败保留页面输入，不发布成功或本地缓存假结果。 */
function mutate<T>(type: DictionaryType, operation: () => Promise<T>): Promise<T> {
  return localOperation(async () => {
    const result = await operation()
    notifyChanged(type)
    return result
  })
}

export function listDictionarySummaries(signal?: AbortSignal) {
  return localOperation(() => dictionaries.summaries(signal))
}

export function listDictionaryItems(
  type: DictionaryType,
  query: string,
  status: DictionaryStatus | '',
  signal?: AbortSignal,
  page = 0,
  size = 100,
  hierarchy: { parentId?: string, rootsOnly?: boolean } = {},
) {
  return localOperation(() => dictionaries.list(type, query, { status, page, size, ...hierarchy }, signal))
}

/** 历史筛选按 ID 回显，包括停用项；候选只读启用项，两者使用同一个字典服务。 */
export function getDictionaryItem(type: DictionaryType, id: string, signal?: AbortSignal): Promise<DictionaryItem> {
  return localOperation(() => dictionaries.get(type, id, signal))
}

export function listDictionaryCandidates(type: DictionaryType, query = '', signal?: AbortSignal) {
  return localOperation(() => dictionaries.list(type, query, { candidates: true, size: 50 }, signal))
}

export function createDictionaryItem(type: DictionaryType, name: string, parentId?: string) {
  return mutate(type, () => dictionaries.create(type, name, parentId || undefined))
}

export function renameDictionaryItem(type: DictionaryType, id: string, name: string) {
  return mutate(type, () => dictionaries.rename(type, id, name))
}

export function changeDictionaryItemStatus(type: DictionaryType, id: string, status: DictionaryStatus) {
  return mutate(type, () => dictionaries.changeStatus(type, id, status))
}

export function moveDictionaryItem(type: DictionaryType, id: string, direction: 'UP' | 'DOWN', targetId?: string) {
  return mutate(type, () => dictionaries.move(type, id, direction, targetId))
}

export function previewProductMerge(sourceProductId: string, targetProductId: string) {
  return localOperation(() => products.preview(sourceProductId, targetProductId))
}

export function mergeProduct(sourceProductId: string, targetProductId: string) {
  return mutate('product', () => products.merge(sourceProductId, targetProductId))
}
