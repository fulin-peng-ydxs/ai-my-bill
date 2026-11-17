/** 与后端 String.codePointCount 保持一致，按 Unicode 码点而非 UTF-16 单元计数。 */
export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length
}

export { dictionaryDisplayName, normalizedDictionaryName } from './dictionaryNameV1'
