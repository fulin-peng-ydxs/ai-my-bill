-- T11：同商品有效历史的价格/频次批量读取；仅追加索引，不改账目和用户配置。
-- 升级由既有保护快照与迁移事务承接，降级恢复升级前快照。
CREATE INDEX ledger_report_history ON ledger_entry(entry_type,lifecycle_status,product_id,business_time,created_at,id);
