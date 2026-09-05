-- 人工回滚 V007：仅限首次部署失败、业务接口从未启动且库内无业务数据的空环境。
-- 影响全部租户表的 policy 和运行角色授权；生产禁止执行，生产 policy 错误必须 forward-fix。
DO $$
DECLARE
    table_name text;
    row_count bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
        RAISE EXCEPTION 'U007 requires the bootstrap database administrator so FORCE RLS cannot hide existing rows';
    END IF;
    FOREACH table_name IN ARRAY ARRAY[
        'expense_category', 'unit', 'funding_channel', 'purchase_channel', 'location_label',
        'income_category', 'payer', 'product', 'ledger_entry', 'expense_adjustment',
        'daily_entry_template', 'user_preference', 'idempotency_record', 'export_job', 'account_deletion_job'
    ] LOOP
        EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
        IF row_count <> 0 THEN
            RAISE EXCEPTION 'U007 refuses non-empty table %', table_name;
        END IF;
    END LOOP;
END
$$;

REVOKE ALL ON tenant, app_user, user_session, auth_rate_limit, default_dictionary_item,
    admin_audit_log, job_run, backup_run FROM my_bill_app;

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'expense_category', 'unit', 'funding_channel', 'purchase_channel', 'location_label',
        'income_category', 'payer', 'product', 'ledger_entry', 'expense_adjustment',
        'daily_entry_template', 'user_preference', 'idempotency_record', 'export_job', 'account_deletion_job'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON %I FROM my_bill_app', table_name);
    END LOOP;
END
$$;

REVOKE SELECT ON flyway_schema_history FROM my_bill_app;
REVOKE USAGE ON SCHEMA public FROM my_bill_app;
