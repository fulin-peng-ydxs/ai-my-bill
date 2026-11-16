import type { RouteLocationRaw } from 'vue-router'
import type { DictionaryType } from './dictionaries'

export type DictionaryOrigin = 'entry' | 'profile'
export function dictionaryOrigin(value: unknown): DictionaryOrigin | undefined {
  return value === 'entry' || value === 'profile' ? value : undefined
}
export function dictionarySourcePath(origin: DictionaryOrigin): string {
  return origin === 'entry' ? '/entry' : '/me'
}
export function dictionaryIndexTarget(from: unknown): RouteLocationRaw {
  const origin = dictionaryOrigin(from)
  return origin ? { path: dictionarySourcePath(origin), query: { panel: 'dictionaries' } } : { name: 'personal-dictionaries' }
}
export function dictionaryDetailTarget(type: DictionaryType, from?: DictionaryOrigin): RouteLocationRaw {
  return { name: 'personal-dictionary-detail', params: { type }, query: from ? { from } : {} }
}
