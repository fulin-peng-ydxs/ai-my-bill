-- PostgreSQL 角色基线：由数据库管理员在首次 Flyway 前使用 psql 执行。
-- 调用方必须通过 psql 变量 migration_password/app_password 传入两类密码；脚本影响角色与 public schema，生产回退只做 revoke/轮换。
-- 仅确认无对象和活动会话的空环境，才可人工执行 rollback/001_drop_roles.sql。
\if :{?app_password}
\else
\getenv app_password MY_BILL_ROLE_APP_PASSWORD
\endif
\if :{?app_password}
\else
\echo 'missing required psql variable: app_password'
\quit 3
\endif
\if :{?migration_password}
\else
\getenv migration_password MY_BILL_ROLE_MIGRATION_PASSWORD
\endif
\if :{?migration_password}
\else
\echo 'missing required psql variable: migration_password'
\quit 3
\endif

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my_bill_migration') THEN
        CREATE ROLE my_bill_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my_bill_app') THEN
        CREATE ROLE my_bill_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'my_bill_backup') THEN
        CREATE ROLE my_bill_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
END
$$;

-- 角色可能由失败的首次部署或人工预置留下；每次 provision 都强制收敛权限，不能只信任 CREATE 时属性。
ALTER ROLE my_bill_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE my_bill_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE my_bill_backup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE my_bill_migration PASSWORD :'migration_password';
ALTER ROLE my_bill_app PASSWORD :'app_password';
GRANT CONNECT ON DATABASE :DBNAME TO my_bill_migration, my_bill_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO my_bill_migration;
GRANT USAGE, CREATE ON SCHEMA public TO my_bill_migration;
REVOKE CREATE ON SCHEMA public FROM my_bill_app;
