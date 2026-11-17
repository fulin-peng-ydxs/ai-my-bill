-- 只增加派生检索键；历史名称、金额、字典、偏好及账目版本均不改写。
-- Unicode NFKC 由同事务的数据步骤回填，SQLite lower() 无法提供该语义。
ALTER TABLE ledger_entry ADD COLUMN normalized_product_name_snapshot TEXT;
CREATE INDEX ledger_product_snapshot_search ON ledger_entry(normalized_product_name_snapshot,business_date);
