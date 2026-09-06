-- T9 商品合并留痕与管理员默认字典规范化。
-- 前置要求 V001-V009 已完成；生产回退使用 forward-fix，U010 仅供尚未产生合并事件的首次部署失败环境。

ALTER TABLE default_dictionary_item ADD COLUMN normalized_name varchar(100);

UPDATE default_dictionary_item
   SET normalized_name = lower(regexp_replace(normalize(btrim(display_name), NFKC), '[[:space:]]+', ' ', 'g'));

ALTER TABLE default_dictionary_item ALTER COLUMN normalized_name SET NOT NULL;
ALTER TABLE default_dictionary_item ADD CONSTRAINT ck_default_dictionary_normalized_name
    CHECK (btrim(normalized_name) <> '');

CREATE UNIQUE INDEX uq_default_dictionary_simple_name
    ON default_dictionary_item (dictionary_type, normalized_name)
    WHERE dictionary_type <> 'EXPENSE_CATEGORY';
CREATE UNIQUE INDEX uq_default_expense_category_root_name
    ON default_dictionary_item (normalized_name)
    WHERE dictionary_type = 'EXPENSE_CATEGORY' AND parent_id IS NULL;
CREATE UNIQUE INDEX uq_default_expense_category_child_name
    ON default_dictionary_item (parent_id, normalized_name)
    WHERE dictionary_type = 'EXPENSE_CATEGORY' AND parent_id IS NOT NULL;

CREATE TABLE product_merge_event (
    tenant_id uuid NOT NULL REFERENCES tenant (id),
    id uuid NOT NULL,
    source_product_id uuid NOT NULL,
    target_product_id uuid NOT NULL,
    initiated_by_user_id uuid NOT NULL,
    affected_ledger_entries bigint NOT NULL CHECK (affected_ledger_entries >= 0),
    affected_templates integer NOT NULL CHECK (affected_templates >= 0),
    template_conflict boolean NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_product_merge_source UNIQUE (tenant_id, source_product_id),
    CONSTRAINT fk_product_merge_source FOREIGN KEY (tenant_id, source_product_id)
        REFERENCES product (tenant_id, id),
    CONSTRAINT fk_product_merge_target FOREIGN KEY (tenant_id, target_product_id)
        REFERENCES product (tenant_id, id),
    CONSTRAINT fk_product_merge_user FOREIGN KEY (tenant_id, initiated_by_user_id)
        REFERENCES app_user (tenant_id, id),
    CONSTRAINT ck_product_merge_distinct CHECK (source_product_id <> target_product_id)
);

CREATE INDEX idx_product_merge_target_time
    ON product_merge_event (tenant_id, target_product_id, occurred_at DESC, id DESC);

ALTER TABLE product_merge_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_merge_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_merge_event FOR ALL TO my_bill_app, my_bill_migration
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON product_merge_event TO my_bill_app;
