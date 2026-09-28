-- T29 合成恢复样本：仅由 verify-recovery-tool.sh 在刚创建的无端口临时库执行。
-- 影响：3 个合成租户，各 10000 条支出、1 个导出；测试退出销毁整个容器，不提供线上回滚。
-- 前置：专用库名、空业务库及显式会话标记；禁止在生产连接上手动运行。
DO $$ BEGIN
  IF current_database() <> 'my_bill_restore_drill'
     OR current_setting('my_bill.synthetic_drill', true) IS DISTINCT FROM 'confirmed'
     OR EXISTS (SELECT 1 FROM ledger_entry) THEN
    RAISE EXCEPTION 'synthetic recovery fixture guard rejected';
  END IF;
END $$;
DO $$
DECLARE t uuid; u uuid; c uuid; n uuid; f uuid; p uuid; e uuid;
BEGIN
  FOR i IN 1..3 LOOP
    t := md5('recovery-tenant-' || i)::uuid;
    u := md5('recovery-user-' || i)::uuid;
    c := md5('recovery-category-' || i)::uuid;
    n := md5('recovery-unit-' || i)::uuid;
    f := md5('recovery-funding-' || i)::uuid;
    p := md5('recovery-product-' || i)::uuid;
    e := md5('recovery-export-' || i)::uuid;
    INSERT INTO tenant(id) VALUES(t);
    INSERT INTO app_user(id,username,password_digest,role,tenant_id)
      VALUES(u,'recovery-fixture-' || i,'unusable-synthetic-password','USER',t);
    INSERT INTO expense_category(tenant_id,id,display_name,normalized_name,status) VALUES(t,c,'恢复分类','恢复分类','ACTIVE');
    INSERT INTO unit(tenant_id,id,display_name,normalized_name,status) VALUES(t,n,'件','件','ACTIVE');
    INSERT INTO funding_channel(tenant_id,id,display_name,normalized_name,status) VALUES(t,f,'恢复钱包','恢复钱包','ACTIVE');
    INSERT INTO product(tenant_id,id,display_name,normalized_name,default_primary_category_id,default_unit_id,last_unit_price,last_quantity,last_funding_channel_id,status)
      VALUES(t,p,'恢复商品','恢复商品',c,n,12.34,2,f,'ACTIVE');
    INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
      primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,calculated_amount,
      paid_amount,funding_channel_id,funding_channel_name_snapshot,note)
      SELECT t,md5('recovery-entry-' || i || '-' || x)::uuid,'EXPENSE',now(),(now() AT TIME ZONE 'Asia/Shanghai')::date,
      p,'恢复商品',c,'恢复分类',n,'件',12.34,2,24.68,24.68,f,'恢复钱包','合成恢复样本' FROM generate_series(1,10000) x;
    INSERT INTO export_job(tenant_id,id,user_id,filter_snapshot,status,file_location,expires_at)
      VALUES(t,e,u,'{}','SUCCEEDED','/var/lib/my-bill/exports/' || t || '/' || e || '.csv',now()+interval '1 day');
  END LOOP;
END $$;
