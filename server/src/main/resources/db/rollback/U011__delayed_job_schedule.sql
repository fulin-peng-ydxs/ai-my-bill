-- 仅供尚未登记任何任务的首次部署失败环境；生产保留调度记录并使用前向修复。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM job_run) THEN
        RAISE EXCEPTION 'U011 requires an empty job_run table';
    END IF;
END;
$$;

DROP INDEX idx_job_run_claim;
CREATE INDEX idx_job_run_claim ON job_run (status, created_at, id) WHERE status = 'PENDING';
ALTER TABLE job_run DROP COLUMN available_at;
