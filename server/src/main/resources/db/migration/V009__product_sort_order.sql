-- T8 让商品与其余七类个人字典共享显式排序合同；已有商品按最近更新时间稳定编号。
-- product 已启用 FORCE RLS；迁移所有者在本事务内暂时解除 FORCE 才能回填全部租户，结束前立即恢复。
ALTER TABLE product NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product ADD COLUMN sort_order integer;

WITH ranked AS (
    SELECT tenant_id, id,
           (row_number() OVER (PARTITION BY tenant_id ORDER BY updated_at DESC, created_at DESC, id) - 1) * 10 AS position
      FROM product
     WHERE status <> 'MERGED'
)
UPDATE product p
   SET sort_order = ranked.position
  FROM ranked
 WHERE p.tenant_id = ranked.tenant_id AND p.id = ranked.id;

UPDATE product SET sort_order = 0 WHERE sort_order IS NULL;
ALTER TABLE product ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE product ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE product ADD CONSTRAINT ck_product_sort_order CHECK (sort_order >= 0);

CREATE INDEX idx_product_dictionary_order
    ON product (tenant_id, status, sort_order, created_at, id);

ALTER TABLE product FORCE ROW LEVEL SECURITY;
