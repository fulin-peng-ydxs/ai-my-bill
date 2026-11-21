import { spawnSync } from 'node:child_process'

export interface RecordedQuery {
  statement: string
  values: (string | number | null)[]
  rows: number
}

export interface QueryProfile {
  steps: number
  plans: string[][]
  rows: number[]
  sqliteVersion: string
}

/** Node 单测专用：只读重放生产入口实际发出的 SQL，计 SQLite VM 指令，不用耗时或 SQL 次数替代扫描量。 */
export function profileSqliteQueries(filename: string, queries: RecordedQuery[]): QueryProfile {
  const result = spawnSync('python3', ['-c', `
import json, sqlite3, sys
from pathlib import Path

connection = sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True)
try:
    connection.execute('PRAGMA query_only=ON')
    steps = [0]
    plans, counts = [], []
    def tick():
        steps[0] += 1
        return 0
    for query in json.load(sys.stdin):
        statement, values = query['statement'], query['values']
        if not statement.startswith('SELECT '):
            raise ValueError('查询剖析只允许 SELECT')
        plans.append([row[3] for row in connection.execute('EXPLAIN QUERY PLAN ' + statement, values)])
        connection.set_progress_handler(tick, 1)
        try:
            counts.append(len(connection.execute(statement, values).fetchall()))
        finally:
            connection.set_progress_handler(None, 0)
    print(json.dumps(dict(steps=steps[0], plans=plans, rows=counts, sqliteVersion=sqlite3.sqlite_version)))
finally:
    connection.close()
`, filename], { input: JSON.stringify(queries), encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) {
    throw new Error('真实 SQLite 查询剖析失败：' + (result.error?.message ?? result.stderr))
  }
  return JSON.parse(result.stdout) as QueryProfile
}
