-- 角色脚本人工回滚：仅限空环境且角色无对象、无活动会话时由数据库管理员执行。
-- 生产禁止直接删除角色；应先轮换凭据并精确 revoke。删除后重跑 ../001_roles.sql 可恢复。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname IN ('my_bill_migration', 'my_bill_app', 'my_bill_backup')
    ) THEN
        RAISE EXCEPTION 'role rollback refuses roles that own database objects';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE usename IN ('my_bill_migration', 'my_bill_app', 'my_bill_backup') AND pid <> pg_backend_pid()
    ) THEN
        RAISE EXCEPTION 'role rollback refuses roles with active sessions';
    END IF;
END
$$;

REVOKE CONNECT ON DATABASE :DBNAME FROM my_bill_migration, my_bill_app;
REVOKE ALL ON SCHEMA public FROM my_bill_migration, my_bill_app, my_bill_backup;
ALTER SCHEMA public OWNER TO CURRENT_USER;
DROP ROLE IF EXISTS my_bill_backup;
DROP ROLE IF EXISTS my_bill_app;
DROP ROLE IF EXISTS my_bill_migration;
