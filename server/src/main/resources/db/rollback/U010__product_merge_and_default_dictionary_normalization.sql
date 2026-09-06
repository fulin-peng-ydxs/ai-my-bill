-- 仅供尚未执行商品合并的首次部署失败环境；有合并留痕时拒绝回滚，生产使用 forward-fix。
-- 默认字典规范化列可由展示名重新生成，因此在无合并事件时允许撤销索引、约束和该派生列。
ALTER TABLE product_merge_event NO FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM product_merge_event) THEN
        RAISE EXCEPTION 'U010 refuses product merge history';
    END IF;
END $$;

DROP TABLE product_merge_event;

DROP INDEX uq_default_expense_category_child_name;
DROP INDEX uq_default_expense_category_root_name;
DROP INDEX uq_default_dictionary_simple_name;
ALTER TABLE default_dictionary_item DROP CONSTRAINT ck_default_dictionary_normalized_name;
ALTER TABLE default_dictionary_item DROP COLUMN normalized_name;
