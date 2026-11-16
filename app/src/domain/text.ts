/** 与后端 String.codePointCount 保持一致，按 Unicode 码点而非 UTF-16 单元计数。 */
export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length
}

// 与旧 Java Normalizer 的 \p{Z}/ASCII \s 一致；不将零宽字符擅自视为空白。
const EDGE_SPACES = /^[\p{Z}\t\n\v\f\r ]+|[\p{Z}\t\n\v\f\r ]+$/gu
const REPEATED_SPACES = /[\p{Z}\t\n\v\f\r ]+/gu

export function dictionaryDisplayName(value: string): string {
  return value.replace(EDGE_SPACES, '')
}

/** 名称键只做 NFKC、空白折叠与稳定小写，不做同义词/标点归并。 */
export function normalizedDictionaryName(value: string): string {
  return dictionaryDisplayName(dictionaryDisplayName(value).normalize('NFKC').replace(REPEATED_SPACES, ' ')).toLowerCase()
}
