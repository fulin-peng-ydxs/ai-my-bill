-- 人工回滚 V006：仅限默认收入分类尚未复制或被使用的开发/首次部署失败环境。
-- 只删除本 migration 的八个稳定键；生产已使用项应停用或以精确 forward migration 修正。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM income_category) THEN
        RAISE EXCEPTION 'U006 refuses rollback after personal income categories exist';
    END IF;
END
$$;

DELETE FROM default_dictionary_item item
USING (VALUES
    ('61000000-0000-0000-0000-000000000001'::uuid, 'salary', '工资', 10),
    ('61000000-0000-0000-0000-000000000002'::uuid, 'bonus', '奖金', 20),
    ('61000000-0000-0000-0000-000000000003'::uuid, 'part_time', '兼职', 30),
    ('61000000-0000-0000-0000-000000000004'::uuid, 'business_income', '经营所得', 40),
    ('61000000-0000-0000-0000-000000000005'::uuid, 'investment_income', '投资收益', 50),
    ('61000000-0000-0000-0000-000000000006'::uuid, 'interest', '利息', 60),
    ('61000000-0000-0000-0000-000000000007'::uuid, 'gift_and_red_packet', '礼金与红包', 70),
    ('61000000-0000-0000-0000-000000000008'::uuid, 'other_income', '其他收入', 80)
) AS seed(id, stable_key, display_name, sort_order)
WHERE item.id = seed.id
  AND item.dictionary_type = 'INCOME_CATEGORY'
  AND item.stable_key = seed.stable_key
  AND item.display_name = seed.display_name
  AND item.sort_order = seed.sort_order
  AND item.status = 'ACTIVE'
  AND item.parent_id IS NULL;
