-- CSV 尾游标按发生时间、类型与 ID 稳定读取键；普通明细/报表索引和历史迁移保持不变。
-- 由共享迁移器在新装或 v8→v9 事务中执行；失败回滚，不删除或重铺用户数据。
CREATE INDEX ledger_export_order ON ledger_entry(business_time,entry_type,id);
CREATE INDEX adjustment_export_order ON expense_adjustment(business_time,id);
