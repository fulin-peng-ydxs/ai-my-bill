package com.mybill.account;

import com.mybill.job.JobBatchResult;
import com.mybill.job.JobDefinition;
import com.mybill.job.JobExecutionContext;
import com.mybill.job.JobScope;
import org.springframework.stereotype.Component;

import java.time.Clock;

@Component
final class ExpiredAccountDeletionAuditJob implements JobDefinition {
    static final String TYPE = "PURGE_ACCOUNT_DELETION_AUDIT";
    private static final int BATCH_SIZE = 100;
    private final AccountDeletionRepository repository;
    private final Clock clock;

    ExpiredAccountDeletionAuditJob(AccountDeletionRepository repository, Clock clock) {
        this.repository = repository; this.clock = clock;
    }

    @Override public String jobType() { return TYPE; }
    @Override public JobScope scope() { return JobScope.GLOBAL; }
    @Override public boolean cancellable() { return false; }
    @Override public boolean retryable() { return true; }
    @Override public JobBatchResult executeBatch(JobExecutionContext context) {
        int deleted = repository.purgeExpiredAudits(clock.instant(), BATCH_SIZE);
        return new JobBatchResult(deleted, deleted < BATCH_SIZE);
    }
}
