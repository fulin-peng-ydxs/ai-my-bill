import initial from './0001_initial.sql?raw'
import initialSchema from './0001_schema.json'
import dictionaryGovernance from './0002_dictionary_governance.sql?raw'
import dictionarySchema from './0002_schema.json'
import ledgerWrites from './0003_ledger_writes.sql?raw'
import ledgerSchema from './0003_schema.json'
import snapshotSearch from './0004_snapshot_search.sql?raw'
import searchSchema from './0004_schema.json'
import searchDataSource from './0004_snapshot_search.ts?raw'
import nameV1Source from '../../domain/dictionaryNameV1.ts?raw'
import { backfillSnapshotSearch } from './0004_snapshot_search'
import type { SqlSession } from '../ledgerDatabase'
import type { SchemaObject } from './schema'
import personalState from './0005_personal_state.sql?raw'
import personalSchema from './0005_schema.json'
import adjustmentLifecycle from './0006_adjustment_lifecycle.sql?raw'
import adjustmentSchema from './0006_schema.json'
import ledgerQuery from './0007_ledger_query.sql?raw'
import querySchema from './0007_schema.json'
import queryDataSource from './0007_ledger_query.ts?raw'
import querySearchSource from '../../domain/ledgerSearchV1.ts?raw'
import { backfillLedgerSearch } from './0007_ledger_query'
import reportDimensions from './0008_report_dimensions.sql?raw'
import reportSchema from './0008_schema.json'
import csvExport from './0009_csv_export.sql?raw'
import csvSchema from './0009_schema.json'

export type Migration = Readonly<{
  version: number
  sql: string
  schema: readonly SchemaObject[]
  data?: Readonly<{ source: string; apply: (sql: SqlSession) => Promise<void> }>
}>
/** 发布后仅追加；当前尚无正式发布的旧版本，原生测试使用受控旧版夹具。 */
export const migrations: readonly Migration[] = [
  { version: 1, sql: initial, schema: initialSchema },
  { version: 2, sql: dictionaryGovernance, schema: dictionarySchema },
  { version: 3, sql: ledgerWrites, schema: ledgerSchema },
  { version: 4, sql: snapshotSearch, schema: searchSchema,
    data: { source: JSON.stringify([searchDataSource, nameV1Source]), apply: backfillSnapshotSearch } },
  { version: 5, sql: personalState, schema: personalSchema },
  { version: 6, sql: adjustmentLifecycle, schema: adjustmentSchema },
  { version: 7, sql: ledgerQuery, schema: querySchema,
    data: { source: JSON.stringify([queryDataSource, querySearchSource, nameV1Source]), apply: backfillLedgerSearch } },
  { version: 8, sql: reportDimensions, schema: reportSchema },
  { version: 9, sql: csvExport, schema: csvSchema },
]
export const publishedSchemaVersions: readonly number[] = []

/** 旧迁移继续使用原 SQL 摘要；含数据步骤的新迁移同时锁定其代码与版本化算法。 */
export function migrationDigest(migration: Migration): Promise<string> {
  return sha256(migration.data ? JSON.stringify([migration.sql, migration.data.source]) : migration.sql)
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
