-- 人工回滚 V001：仅限无账号、会话、限流或租户数据的首次部署失败环境。
-- 生产有身份数据后禁止执行；回滚后可重跑 V001 恢复结构。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM app_user) OR EXISTS (SELECT 1 FROM user_session)
       OR EXISTS (SELECT 1 FROM auth_rate_limit) OR EXISTS (SELECT 1 FROM tenant) THEN
        RAISE EXCEPTION 'U001 refuses rollback after identity data exists';
    END IF;
END
$$;

DROP TABLE auth_rate_limit, user_session, app_user, tenant;
