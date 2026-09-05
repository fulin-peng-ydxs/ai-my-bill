-- T2 租户 RLS 与最小运行权限。前置要求 my_bill_app 已由 deploy/postgres/001_roles.sql 创建。
-- 所有 policy 同时限制 USING/WITH CHECK；上下文缺失或非法时不返回任何租户行。生产禁止执行 U007 关闭防线。

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my_bill_app') THEN
        RAISE EXCEPTION 'required database role my_bill_app is missing';
    END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO my_bill_app;

GRANT SELECT, INSERT, UPDATE ON tenant, app_user TO my_bill_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_session, auth_rate_limit TO my_bill_app;
GRANT SELECT, INSERT, UPDATE ON default_dictionary_item TO my_bill_app;
GRANT SELECT, INSERT ON admin_audit_log TO my_bill_app;
GRANT SELECT, INSERT, UPDATE ON job_run, backup_run TO my_bill_app;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'expense_category', 'unit', 'funding_channel', 'purchase_channel', 'location_label',
        'income_category', 'payer', 'product', 'ledger_entry', 'expense_adjustment',
        'daily_entry_template', 'user_preference', 'idempotency_record', 'export_job',
        'account_deletion_job'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I FOR ALL TO my_bill_app, my_bill_migration USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO my_bill_app', table_name);
    END LOOP;
END
$$;

GRANT SELECT ON flyway_schema_history TO my_bill_app;
