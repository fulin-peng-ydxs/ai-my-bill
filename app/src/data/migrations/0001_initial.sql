-- 本 App 私有 SQLite 新库基础；仅由生命周期管理器在事务中执行一次。
-- 版本/摘要与初始化标记同事务提交；失败回滚，禁止用重铺 seed 修复旧库。
CREATE TABLE ledger_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 schema_version INTEGER NOT NULL CHECK(schema_version>=1),
 dataset_id TEXT NOT NULL UNIQUE,
 initialized INTEGER NOT NULL CHECK(initialized=1),
 seed_version INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 history_start TEXT NOT NULL
) STRICT;
CREATE TABLE migration_history (
 version INTEGER PRIMARY KEY,
 digest TEXT NOT NULL,
 completed_at TEXT NOT NULL
) STRICT;
-- 八类字典共用标识；具体商品属性及业务约束在对应领域迁移中扩充。
CREATE TABLE dictionary_item (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('PRODUCT','EXPENSE_CATEGORY','UNIT','FUNDING_CHANNEL','PURCHASE_CHANNEL','PAYER','INCOME_CATEGORY','LOCATION_LABEL')),
 name TEXT NOT NULL,
 normalized_name TEXT NOT NULL,
 parent_id TEXT REFERENCES dictionary_item(id) ON DELETE RESTRICT,
 status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
 sort_order INTEGER NOT NULL DEFAULT 0,
 row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
 seed_key TEXT,
 seed_version INTEGER,
 CHECK(parent_id IS NULL OR (kind='EXPENSE_CATEGORY' AND parent_id<>id))
) STRICT;
CREATE UNIQUE INDEX dictionary_root_name ON dictionary_item(kind,normalized_name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX dictionary_child_name ON dictionary_item(kind,parent_id,normalized_name) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX dictionary_seed_key ON dictionary_item(kind,seed_key) WHERE seed_key IS NOT NULL;
CREATE INDEX dictionary_candidates ON dictionary_item(kind,status,sort_order,id);
-- JSON 只用于偏好值；金额与正式账目字段不得放入 JSON 替代定点列。
CREATE TABLE preference (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value))) STRICT;
CREATE TABLE idempotency_result (
 operation TEXT NOT NULL,
 operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 128),
 request_digest TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(operation,operation_id)
) STRICT;
-- 后续收支服务的共同记录骨架；类型专有字段/规则由对应功能追加迁移。
-- 名称快照不随字典更名改变；金额列为分，原生桥绑定/读取须用十进制字符串。
CREATE TABLE ledger_entry (
 id TEXT PRIMARY KEY,
 entry_type TEXT NOT NULL CHECK(entry_type IN ('EXPENSE','INCOME')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 0 AND 99999999999),
 funding_channel_id TEXT NOT NULL REFERENCES dictionary_item(id) ON DELETE RESTRICT,
 funding_channel_name_snapshot TEXT NOT NULL,
 business_time TEXT NOT NULL,
 business_date TEXT NOT NULL,
 row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version>0),
 lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle_status IN ('ACTIVE','TRASHED')),
 deleted_at TEXT,
 purge_after TEXT,
 CHECK((lifecycle_status='ACTIVE' AND deleted_at IS NULL AND purge_after IS NULL) OR
       (lifecycle_status='TRASHED' AND deleted_at IS NOT NULL AND purge_after IS NOT NULL))
) STRICT;
CREATE INDEX ledger_date ON ledger_entry(lifecycle_status,business_date,business_time,id);
CREATE INDEX ledger_funding ON ledger_entry(funding_channel_id,business_date,id);
