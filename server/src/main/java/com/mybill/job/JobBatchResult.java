package com.mybill.job;

public record JobBatchResult(long processedCount, boolean completed) {
    public JobBatchResult {
        if (processedCount < 0) throw new IllegalArgumentException("processedCount must not be negative");
    }
    public static JobBatchResult completed(long count) { return new JobBatchResult(count, true); }
    public static JobBatchResult more(long count) { return new JobBatchResult(count, false); }
}
