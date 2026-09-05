-- 人工回滚 V003：仅限无账目与调整的开发或首次部署失败环境。
-- 发现业务数据即拒绝；生产使用前向兼容 migration 和导出校验。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ledger_entry) OR EXISTS (SELECT 1 FROM expense_adjustment) THEN
        RAISE EXCEPTION 'U003 refuses rollback after ledger or adjustment data exists';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_sync_adjustments_with_source_lifecycle ON ledger_entry;
DROP FUNCTION IF EXISTS sync_adjustments_with_source_lifecycle();
DROP TRIGGER IF EXISTS trg_protect_expense_with_adjustments ON ledger_entry;
DROP FUNCTION IF EXISTS protect_expense_with_adjustments();
DROP TRIGGER IF EXISTS trg_validate_expense_adjustment_total ON expense_adjustment;
DROP FUNCTION IF EXISTS validate_expense_adjustment_total();
DROP TABLE expense_adjustment, ledger_entry;
