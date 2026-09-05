-- T6 后台任务执行契约。扩展既有 job_run，使单机或多实例 runner 可安全争抢小批次、续租、取消和失败重试。
-- 本迁移只增加任务元数据和约束，不创建业务任务或 seed；生产回退采用 forward-fix，空环境可执行对应 U008。

ALTER TABLE job_run
    ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    ADD COLUMN lease_owner varchar(128),
    ADD COLUMN lease_expires_at timestamptz,
    ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;

-- T6 以前没有正式 runner；若环境中存在人工写入的 RUNNING 记录，升级时安全收敛为失败，避免误判仍在执行。
UPDATE job_run
   SET status = 'FAILED',
       finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
       error_summary = COALESCE(error_summary, '升级前运行任务状态不完整，已安全收敛。'),
       updated_at = CURRENT_TIMESTAMP
 WHERE status = 'RUNNING';

ALTER TABLE job_run
    ADD CONSTRAINT ck_job_run_lease CHECK (
        (status = 'RUNNING' AND started_at IS NOT NULL AND finished_at IS NULL
            AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'RUNNING' AND lease_owner IS NULL AND lease_expires_at IS NULL
            AND cancel_requested = false)
    ),
    ADD CONSTRAINT ck_job_run_attempt_limit CHECK (attempt_count <= max_attempts);

-- 同一任务类型、租户和批次键只允许一个任务；NULLS NOT DISTINCT 让全局任务也遵循相同幂等语义。
CREATE UNIQUE INDEX uq_job_run_business_key
    ON job_run (job_type, tenant_id, batch_key) NULLS NOT DISTINCT
    WHERE batch_key IS NOT NULL;

CREATE INDEX idx_job_run_claim
    ON job_run (status, created_at, id)
    WHERE status = 'PENDING';

CREATE INDEX idx_job_run_expired_lease
    ON job_run (lease_expires_at, id)
    WHERE status = 'RUNNING';
