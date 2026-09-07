-- T17 到期清理延迟调度。任务先记录，只有到达 available_at 后才允许 runner 领取。
-- 影响 job_run 领取顺序与索引；不写业务 seed。生产已产生任务后只允许 forward-fix。

ALTER TABLE job_run ADD COLUMN available_at timestamptz;
UPDATE job_run SET available_at = created_at WHERE available_at IS NULL;
ALTER TABLE job_run ALTER COLUMN available_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE job_run ALTER COLUMN available_at SET NOT NULL;

DROP INDEX idx_job_run_claim;
CREATE INDEX idx_job_run_claim
    ON job_run (status, available_at, created_at, id)
    WHERE status = 'PENDING';
