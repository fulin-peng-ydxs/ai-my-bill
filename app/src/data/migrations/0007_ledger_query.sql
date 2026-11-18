-- T9：快照搜索键和稳定分批索引；仅由升级事务执行，数据回填与 DDL/履历原子提交。
-- 不修改金额、名称、行版本、字典及偏好；降级须恢复升级前保护快照，不自动删列。
ALTER TABLE ledger_entry ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
ALTER TABLE ledger_entry ADD COLUMN adjustment_source_search_text TEXT NOT NULL DEFAULT '';
ALTER TABLE expense_adjustment ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
CREATE INDEX ledger_query_order ON ledger_entry(lifecycle_status,business_date DESC,business_time DESC,created_at DESC,id DESC);
CREATE INDEX ledger_query_type ON ledger_entry(lifecycle_status,entry_type,business_date DESC,business_time DESC,created_at DESC,id DESC);
CREATE INDEX adjustment_query_order ON expense_adjustment(status,business_date DESC,business_time DESC,created_at DESC,id DESC);
