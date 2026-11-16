import initial from './0001_initial.sql?raw'
import initialSchema from './0001_schema.json'
import type { SchemaObject } from './schema'

export type Migration = Readonly<{ version: number; sql: string; schema: readonly SchemaObject[] }>
/** 发布后仅追加；当前尚无正式发布的旧版本，原生测试使用受控旧版夹具。 */
export const migrations: readonly Migration[] = [{ version: 1, sql: initial, schema: initialSchema }]
export const publishedSchemaVersions: readonly number[] = []

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
