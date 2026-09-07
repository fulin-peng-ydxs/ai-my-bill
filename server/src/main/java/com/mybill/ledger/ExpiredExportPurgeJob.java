package com.mybill.ledger;

import com.mybill.job.JobBatchResult;
import com.mybill.job.JobDefinition;
import com.mybill.job.JobExecutionContext;
import com.mybill.job.JobScope;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Component
class ExpiredExportPurgeJob implements JobDefinition {
    static final String TYPE = "PURGE_EXPIRED_EXPORT";
    private final ExportRepository repository;
    private final ExportFileStore files;
    private final Clock clock;

    ExpiredExportPurgeJob(ExportRepository repository, ExportFileStore files, Clock clock) {
        this.repository = repository; this.files = files; this.clock = clock;
    }

    @Override public String jobType() { return TYPE; }
    @Override public JobScope scope() { return JobScope.TENANT; }
    @Override public boolean cancellable() { return false; }
    @Override public boolean retryable() { return true; }

    @Override public JobBatchResult executeBatch(JobExecutionContext context) {
        UUID exportId = UUID.fromString(context.batchKey());
        ExportRepository.JobRow row = repository.findForJob(exportId).orElse(null);
        Instant now = clock.instant();
        if (row != null && !row.expiresAt().isAfter(now)) {
            files.delete(row.fileLocation());
            repository.markExpired(exportId, now);
        }
        return JobBatchResult.completed(row == null ? 0 : 1);
    }
}
