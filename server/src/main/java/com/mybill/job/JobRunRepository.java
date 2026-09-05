package com.mybill.job;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface JobRunRepository {
    UUID schedule(String jobType, UUID tenantId, String batchKey, int maxAttempts, Instant now);
    Optional<JobRun> find(UUID runId);
    Optional<JobRun> claimNext(Collection<String> jobTypes, String owner, Instant now, Instant leaseUntil);
    boolean renew(UUID runId, String owner, Instant now, Instant leaseUntil);
    boolean isCancellationRequested(UUID runId, String owner);
    void complete(UUID runId, String owner, long processed, Instant now);
    void releaseForMore(UUID runId, String owner, long processed, Instant now);
    void cancel(UUID runId, String owner, long processed, Instant now);
    void failOrRetry(UUID runId, String owner, boolean retry, String safeError, Instant now);
    List<JobRun> findExpired(Instant now);
    void recoverExpired(UUID runId, boolean retry, String safeError, Instant now);
    String requestCancellation(UUID runId, boolean cancellable, Instant now);
}
