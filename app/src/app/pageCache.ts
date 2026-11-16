import type { RouteLocationNormalizedLoaded } from 'vue-router'

import { dictionaryDefinition, dictionaryDefinitions } from '../domain/dictionaries'
import { pageRegistry } from './pageRegistry'

// 一个字典类型一个实例；筛选/query 继续更新同一页，避免无限积累缓存。
export const pageCacheLimit = pageRegistry.length + dictionaryDefinitions.length - 1
export function pageCacheKey(route: Pick<RouteLocationNormalizedLoaded, 'name' | 'params'>): string {
  const name = String(route.name ?? '')
  return name === 'personal-dictionary-detail'
    ? `${name}:${dictionaryDefinition(route.params.type)?.type ?? 'invalid'}`
    : name
}
