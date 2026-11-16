import { LocalError } from '../../domain/localError'

/** 每个已知版本的完整持久化结构；SQL 定义同时覆盖 CHECK、FK、列类型与索引唯一性。 */
export type SchemaObject = Readonly<{ type: string; name: string; tableName: string; sql: string }>
/** 只忽略语法外空白/注释；保留词边界及引号内的精确内容。 */
export function schemaSqlTokens(sql: string): string[] {
  const tokens = sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|[\p{L}_][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|\s+|[^\s]/gu) ?? []
  return tokens.filter(token => !/^\s|^--|^\/\*/.test(token))
}
export function assertSchema(actual: readonly SchemaObject[], expected: readonly SchemaObject[]): void {
  const canonical = (objects: readonly SchemaObject[]) => objects.map(o => ({ type: o.type, name: o.name, tableName: o.tableName, sql: schemaSqlTokens(o.sql) }))
    .sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const received = canonical(actual), contract = canonical(expected)
  if (JSON.stringify(received) !== JSON.stringify(contract)) {
    const index = contract.findIndex((item, i) => JSON.stringify(item) !== JSON.stringify(received[i]))
    throw new LocalError('DATABASE_INCOMPATIBLE', '账本结构、字段或约束与已知版本不一致。', { cause: { actual: received[index < 0 ? contract.length : index], expected: contract[index] } })
  }
}
