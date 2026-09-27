-- 仅用于空环境 V012 首次部署失败后的人工回滚；会删除全部匿名注销审计，不可用于生产降级。
DROP TRIGGER IF EXISTS trg_guard_admin_audit_anonymization ON admin_audit_log;
DROP FUNCTION IF EXISTS guard_admin_audit_anonymization();
DROP INDEX IF EXISTS idx_admin_audit_target;
DROP TRIGGER IF EXISTS trg_guard_job_run_deletion ON job_run;
DROP TRIGGER IF EXISTS trg_guard_tenant_deletion ON tenant;
DROP TRIGGER IF EXISTS trg_guard_app_user_deletion ON app_user;
DROP FUNCTION IF EXISTS guard_account_deletion_runtime_privileges();
DROP TABLE IF EXISTS account_deletion_audit;
REVOKE DELETE ON tenant, app_user, job_run FROM my_bill_app;
REVOKE DELETE ON product_merge_event FROM my_bill_app;
REVOKE UPDATE ON admin_audit_log FROM my_bill_app;
