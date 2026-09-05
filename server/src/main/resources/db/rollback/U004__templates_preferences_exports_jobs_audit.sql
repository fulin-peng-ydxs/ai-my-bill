-- 人工回滚 V004：仅限无模板、偏好、任务、幂等或审计数据的空环境。
-- 生产先停任务、回退应用并 forward-fix；脚本发现任一数据即拒绝执行。
DO $$
DECLARE table_name text; row_count bigint;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'daily_entry_template', 'user_preference', 'idempotency_record', 'export_job',
        'account_deletion_job', 'admin_audit_log', 'job_run', 'backup_run'
    ] LOOP
        EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
        IF row_count <> 0 THEN RAISE EXCEPTION 'U004 refuses non-empty table %', table_name; END IF;
    END LOOP;
END
$$;

DROP TRIGGER IF EXISTS trg_detach_templates_from_deleted_ledger ON ledger_entry;
DROP FUNCTION IF EXISTS detach_templates_from_deleted_ledger();
DROP TRIGGER IF EXISTS trg_validate_daily_template_source ON daily_entry_template;
DROP FUNCTION IF EXISTS validate_daily_template_source();
DROP TABLE backup_run, job_run, admin_audit_log, account_deletion_job, export_job,
    idempotency_record, user_preference, daily_entry_template;
