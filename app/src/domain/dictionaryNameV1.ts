/** 持久化名称键 v1；0004 数据迁移摘要包含本文件，后续规则须新增版本而非改写。 */
const EDGE_SPACES = /^[\p{Z}\t\n\v\f\r ]+|[\p{Z}\t\n\v\f\r ]+$/gu
const REPEATED_SPACES = /[\p{Z}\t\n\v\f\r ]+/gu

export function dictionaryDisplayName(value: string): string {
  return value.replace(EDGE_SPACES, '')
}

/** 与已有字典一致：NFKC、首尾空白、连续空白及稳定小写；不合并标点或同义词。 */
export function normalizedDictionaryName(value: string): string {
  return dictionaryDisplayName(dictionaryDisplayName(value).normalize('NFKC').replace(REPEATED_SPACES, ' ')).toLowerCase()
}
