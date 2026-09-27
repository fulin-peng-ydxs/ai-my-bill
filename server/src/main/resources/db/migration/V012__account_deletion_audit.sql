-- T19 账号注销匿名审计。注销后不保留目标账号、用户名或租户标识，记录仅保留 180 天。
-- 由迁移所有者在 V011 后执行；生产仅前向修复。空环境失败时可执行 U012 回滚。

CREATE TABLE account_deletion_audit (
    id uuid PRIMARY KEY,
    actor_type varchar(16) NOT NULL CHECK (actor_type IN ('SELF', 'ADMIN')),
    subject_digest char(64) NOT NULL CHECK (subject_digest ~ '^[0-9a-f]{64}$'),
    status varchar(16) NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
    requested_at timestamptz NOT NULL,
    executed_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    result_summary varchar(128) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_account_deletion_audit_expiry CHECK (expires_at > executed_at)
);

CREATE INDEX idx_account_deletion_audit_expiry ON account_deletion_audit (expires_at, id);
CREATE INDEX idx_account_deletion_audit_subject ON account_deletion_audit (subject_digest);
CREATE INDEX idx_admin_audit_target ON admin_audit_log (object_type, object_id);

GRANT SELECT, INSERT, DELETE ON account_deletion_audit TO my_bill_app;
-- 注销应用服务只通过固定 Mapper 条件删除普通用户及其租户；V007 的其余最小权限保持不变。
GRANT DELETE ON tenant, app_user, job_run TO my_bill_app;
GRANT DELETE ON product_merge_event TO my_bill_app;
GRANT UPDATE ON admin_audit_log TO my_bill_app;

CREATE FUNCTION guard_account_deletion_runtime_privileges() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user <> 'my_bill_app' THEN RETURN OLD; END IF;
    IF TG_TABLE_NAME = 'app_user' AND to_jsonb(OLD)->>'role' <> 'USER' THEN
        RAISE EXCEPTION 'runtime role may only delete ordinary users';
    END IF;
    IF TG_TABLE_NAME = 'tenant' AND EXISTS (
        SELECT 1 FROM app_user WHERE tenant_id = (to_jsonb(OLD)->>'id')::uuid
    ) THEN
        RAISE EXCEPTION 'runtime role may only delete orphaned tenants';
    END IF;
    IF TG_TABLE_NAME = 'job_run' AND to_jsonb(OLD)->>'tenant_id' IS NULL THEN
        RAISE EXCEPTION 'runtime role may not delete global jobs';
    END IF;
    RETURN OLD;
END
$$;

CREATE TRIGGER trg_guard_app_user_deletion BEFORE DELETE ON app_user
    FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_runtime_privileges();
CREATE TRIGGER trg_guard_tenant_deletion BEFORE DELETE ON tenant
    FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_runtime_privileges();
CREATE TRIGGER trg_guard_job_run_deletion BEFORE DELETE ON job_run
    FOR EACH ROW EXECUTE FUNCTION guard_account_deletion_runtime_privileges();

CREATE FUNCTION guard_admin_audit_anonymization() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF current_user <> 'my_bill_app' THEN RETURN NEW; END IF;
    IF OLD.object_type <> 'USER'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.administrator_user_id IS DISTINCT FROM OLD.administrator_user_id
       OR NEW.action IS DISTINCT FROM OLD.action
       OR NEW.object_type IS DISTINCT FROM OLD.object_type
       OR NEW.result IS DISTINCT FROM OLD.result
       OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
       OR NEW.safe_summary <> '{}'::jsonb
       OR NEW.object_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'runtime role may only anonymize ordinary-user audit references';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER trg_guard_admin_audit_anonymization BEFORE UPDATE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION guard_admin_audit_anonymization();
