import { describe, expect, it } from 'vitest'
import initialSchema from './0001_schema.json'
import { assertSchema, schemaSqlTokens } from './schema'

describe('按版本的持久化结构契约', () => {
  it('保留对象顺序/原生 JSON 键顺序差异，拒绝同名但定义不同的结构', () => {
    expect(() => assertSchema([...initialSchema].reverse().map(o => ({ sql: o.sql, tableName: o.tableName, name: o.name, type: o.type })), initialSchema)).not.toThrow()
    for (const mutate of [
      (sql: string) => sql.replace('CREATE UNIQUE INDEX', 'CREATE INDEX'),
      (sql: string) => sql.replace('amount_cents INTEGER', 'amount_cents REAL'),
      (sql: string) => sql.replace('CHECK(json_valid(value))', ''),
      (sql: string) => sql.replace('ON DELETE RESTRICT', 'ON DELETE CASCADE'),
    ]) {
      const actual = initialSchema.map(o => ({ ...o, sql: mutate(o.sql) }))
      expect(() => assertSchema(actual, initialSchema)).toThrow('结构、字段或约束')
    }
  })
  it('忽略缩进和注释时不吞并 SQL 词边界或字符串里的空格', () => {
    expect(schemaSqlTokens("CREATE TABLE x(\n id TEXT -- column\n) STRICT")).toEqual(schemaSqlTokens('CREATE  TABLE x(id TEXT) STRICT'))
    expect(schemaSqlTokens('NOT NULL')).not.toEqual(schemaSqlTokens('NOTNULL'))
    expect(schemaSqlTokens("DEFAULT 'cash wallet'")).not.toEqual(schemaSqlTokens("DEFAULT 'cashwallet'"))
  })
  it('使用旧版本自身契约；未知新增对象必须显式纳入目标版本', () => {
    const added = { type: 'index', name: 'new_index', tableName: 'preference', sql: 'CREATE INDEX new_index ON preference(value)' }
    expect(() => assertSchema(initialSchema, initialSchema)).not.toThrow()
    expect(() => assertSchema([...initialSchema, added], initialSchema)).toThrow()
    expect(() => assertSchema([...initialSchema, added], [...initialSchema, added])).not.toThrow()
  })
})
