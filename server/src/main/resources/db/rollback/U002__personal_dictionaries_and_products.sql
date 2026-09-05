-- 人工回滚 V002：仅限尚未创建个人字典、商品或默认项的空环境。
-- 影响七类字典、商品和默认项；存在任一数据即拒绝，生产只能 forward-fix。
DO $$
DECLARE table_name text; row_count bigint;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'expense_category', 'unit', 'funding_channel', 'purchase_channel', 'location_label',
        'income_category', 'payer', 'product', 'default_dictionary_item'
    ] LOOP
        EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
        IF row_count <> 0 THEN RAISE EXCEPTION 'U002 refuses non-empty table %', table_name; END IF;
    END LOOP;
END
$$;

DROP TRIGGER IF EXISTS trg_enforce_expense_category_depth ON expense_category;
DROP FUNCTION IF EXISTS enforce_expense_category_depth();
DROP TRIGGER IF EXISTS trg_enforce_default_category_depth ON default_dictionary_item;
DROP FUNCTION IF EXISTS enforce_default_category_depth();
DROP TABLE product, payer, income_category, location_label, purchase_channel,
    funding_channel, unit, expense_category, default_dictionary_item;
