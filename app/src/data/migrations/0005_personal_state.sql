-- T7：每个本地数据集各一份支出/收入草稿；仅存编辑状态，不替代正式账目。
-- 生命周期事务内追加；失败随 DDL/履历回滚，重开重试。不改写已有偏好、模板或旧迁移。
CREATE TABLE ledger_draft (
  dataset_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('EXPENSE','INCOME')),
  schema_version INTEGER NOT NULL CHECK(schema_version>=1),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(dataset_id,entry_type)
) STRICT;
-- 收入模板名称使用白名单字段保存；旧模板以已保存的展示名兼容回填，不查已删除来源。
ALTER TABLE daily_entry_template ADD COLUMN income_name TEXT;
UPDATE daily_entry_template SET income_name=display_name WHERE entry_type='INCOME' AND income_name IS NULL;
-- 仅真正缺失的字段补缺省；合法用户值以及 false/0/空值均不覆盖。
INSERT OR IGNORE INTO preference VALUES('defaultFundingChannelId','null');
INSERT OR IGNORE INTO preference VALUES('ledgerRange','"TODAY"');
INSERT OR IGNORE INTO preference VALUES('reportRange','"THIS_MONTH"');
INSERT OR IGNORE INTO preference VALUES('theme','"SYSTEM"');
INSERT OR IGNORE INTO preference VALUES('recentEntryType','"EXPENSE"');
