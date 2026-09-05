package com.mybill.job;

import java.util.UUID;
import java.util.function.BooleanSupplier;

public record JobExecutionContext(UUID runId, UUID tenantId, String batchKey,
                                  BooleanSupplier cancellationRequested, Runnable renewLease) {
    public boolean shouldCancel() { return cancellationRequested.getAsBoolean(); }
    public void heartbeat() { renewLease.run(); }
}
