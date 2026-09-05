-- 仅供没有商品数据的首次部署失败环境；生产使用兼容的前向修复迁移。
ALTER TABLE product NO FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM product) THEN
        RAISE EXCEPTION 'U009 requires an empty product table';
    END IF;
END $$;

DROP INDEX idx_product_dictionary_order;
ALTER TABLE product DROP CONSTRAINT ck_product_sort_order;
ALTER TABLE product DROP COLUMN sort_order;
ALTER TABLE product FORCE ROW LEVEL SECURITY;
