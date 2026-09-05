-- 仅用于尚未运行正式后台任务的空开发/首次部署失败环境，撤销 T6 job_run 执行元数据。
-- 若 job_run 已有记录或生产任务已启用，禁止执行；应保留记录并使用兼容的前向修复 migration。

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM job_run) THEN
        RAISE EXCEPTION 'U008 requires an empty job_run table';
    END IF;
END;
$$;

DROP INDEX IF EXISTS idx_job_run_expired_lease;
DROP INDEX IF EXISTS idx_job_run_claim;
DROP INDEX IF EXISTS uq_job_run_business_key;

ALTER TABLE job_run
    DROP CONSTRAINT IF EXISTS ck_job_run_attempt_limit,
    DROP CONSTRAINT IF EXISTS ck_job_run_lease,
    DROP COLUMN IF EXISTS cancel_requested,
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS lease_owner,
    DROP COLUMN IF EXISTS max_attempts,
    DROP COLUMN IF EXISTS attempt_count;
