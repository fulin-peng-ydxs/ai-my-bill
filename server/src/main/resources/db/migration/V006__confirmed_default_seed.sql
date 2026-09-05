-- T2 已确认默认收入分类 seed。稳定 UUID/键只补缺，不覆盖管理员后续修改的名称、排序或状态。
-- 仅在默认项尚未复制或引用时可人工执行 U006；生产数据修正必须另建精确的 forward migration。

INSERT INTO default_dictionary_item (id, dictionary_type, stable_key, display_name, sort_order, status)
VALUES
    ('61000000-0000-0000-0000-000000000001', 'INCOME_CATEGORY', 'salary', '工资', 10, 'ACTIVE'),
    ('61000000-0000-0000-0000-000000000002', 'INCOME_CATEGORY', 'bonus', '奖金', 20, 'ACTIVE'),
    ('61000000-0000-0000-0000-000000000003', 'INCOME_CATEGORY', 'part_time', '兼职', 30, 'ACTIVE'),
    ('61000000-0000-0000-0000-000000000004', 'INCOME_CATEGORY', 'business_income', '经营所得', 40, 'ACTIVE'),
    ('61000000-0000-0000-0000-000000000005', 'INCOME_CATEGORY', 'investment_income', '投资收益', 50, 'ACTIVE'),
    ('61000000-0000-0000-0000-000000000006', 'INCOME_CATEGORY', 'interest', '利息', 60, 'ACTIVE'),
    ('61000000-0000-0000-0000-000000000007', 'INCOME_CATEGORY', 'gift_and_red_packet', '礼金与红包', 70, 'ACTIVE'),
    ('61000000-0000-0000-0000-000000000008', 'INCOME_CATEGORY', 'other_income', '其他收入', 80, 'ACTIVE')
ON CONFLICT (dictionary_type, stable_key) DO NOTHING;
