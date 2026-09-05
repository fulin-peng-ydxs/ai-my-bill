package com.mybill.job;

import java.time.Instant;
import java.util.UUID;

public record JobRun(UUID id, UUID tenantId, String jobType, String batchKey, String status,
                     long processedCount, int attemptCount, int maxAttempts, String leaseOwner,
                     Instant leaseExpiresAt, boolean cancelRequested) { }
