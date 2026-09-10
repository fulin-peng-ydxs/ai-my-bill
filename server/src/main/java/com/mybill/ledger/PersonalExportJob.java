package com.mybill.ledger;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.job.JobBatchResult;
import com.mybill.job.JobDefinition;
import com.mybill.job.JobExecutionContext;
import com.mybill.job.JobScope;
import com.mybill.ledger.ExportContracts.ExportSnapshot;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Component
class PersonalExportJob implements JobDefinition {
    static final String TYPE = "GENERATE_PERSONAL_EXPORT";
    private static final Logger log = LoggerFactory.getLogger(PersonalExportJob.class);
    private final ExportRepository repository;
    private final ExportCsvWriter csv;
    private final ExportFileStore files;
    private final ObjectMapper mapper;
    private final Clock clock;

    PersonalExportJob(ExportRepository repository, ExportCsvWriter csv, ExportFileStore files,
                      ObjectMapper mapper, Clock clock) {
        this.repository = repository; this.csv = csv; this.files = files; this.mapper = mapper; this.clock = clock;
    }

    @Override public String jobType() { return TYPE; }
    @Override public JobScope scope() { return JobScope.TENANT; }
    @Override public boolean cancellable() { return true; }
    @Override public boolean retryable() { return false; }

    @Override
    public JobBatchResult executeBatch(JobExecutionContext context) {
        UUID exportId = UUID.fromString(context.batchKey());
        ExportRepository.JobRow job = repository.findForJob(exportId).orElse(null);
        Instant now = clock.instant();
        if (job == null || job.status().equals("CANCELLED") || job.status().equals("EXPIRED")) {
            return JobBatchResult.completed(0);
        }
        if (!job.expiresAt().isAfter(now)) {
            files.delete(job.fileLocation()); repository.markExpired(exportId, now); return JobBatchResult.completed(0);
        }
        if (!repository.markRunning(exportId, now)) return JobBatchResult.completed(0);
        ExportFileStore.PendingFile pending = null;
        String committedLocation = null;
        try {
            pending = files.create(context.tenantId(), exportId);
            long rows = csv.write(mapper.readValue(job.snapshotJson(), ExportSnapshot.class), pending.writer(), context);
            if (!job.expiresAt().isAfter(clock.instant())) {
                files.abort(pending); pending = null; repository.markExpired(exportId, clock.instant());
                return JobBatchResult.completed(0);
            }
            String location = files.commit(pending);
            committedLocation = location;
            pending = null;
            if (context.shouldCancel()) {
                repository.markCancelled(exportId, clock.instant());
                files.delete(location);
                repository.clearCancelledFileLocation(exportId, clock.instant());
                return JobBatchResult.completed(0);
            }
            repository.markSucceeded(exportId, location, clock.instant());
            return JobBatchResult.completed(rows);
        } catch (ExportCsvWriter.ExportCancelledException cancelled) {
            files.abort(pending); repository.markCancelled(exportId, clock.instant());
            return JobBatchResult.completed(0);
        } catch (Exception failure) {
            log.error("Personal export generation failed exportId={} failure={}",
                    exportId, failure.getClass().getSimpleName());
            files.abort(pending);
            if (committedLocation != null) {
                try { files.delete(committedLocation); } catch (RuntimeException ignored) { }
            }
            repository.markFailed(exportId, "EXPORT_GENERATION_FAILED", clock.instant());
            return JobBatchResult.completed(0);
        }
    }

    @Override
    public void onCancellationWon(JobExecutionContext context) {
        UUID exportId = UUID.fromString(context.batchKey());
        ExportRepository.JobRow job = repository.findForJob(exportId).orElse(null);
        if (job == null) return;
        repository.markCancelled(exportId, clock.instant());
        try {
            files.delete(job.fileLocation());
            repository.clearCancelledFileLocation(exportId, clock.instant());
        } catch (RuntimeException failure) {
            log.warn("Cancelled export file retained for expiry cleanup exportId={} failure={}",
                    exportId, failure.getClass().getSimpleName());
        }
    }
}
