package com.mybill.ledger;

import com.mybill.job.JobBatchResult;
import com.mybill.job.JobDefinition;
import com.mybill.job.JobExecutionContext;
import com.mybill.job.JobScope;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 按租户小批次清理到期回收站；先删关联调整，保证任意重跑都不会留下孤立记录。 */
@Component
final class ExpiredLedgerPurgeJob implements JobDefinition {
    static final String TYPE = "PURGE_EXPIRED_LEDGER";
    private static final int BATCH_SIZE = 100;
    private final MybatisOperations operations;
    private final ExpiredLedgerPurgeJobMapper mapper;
    private final Clock clock;

    ExpiredLedgerPurgeJob(MybatisOperations operations, ExpiredLedgerPurgeJobMapper mapper, Clock clock) { this.operations = operations; this.mapper = mapper; this.clock = clock; }

    @Override public String jobType() { return TYPE; }
    @Override public JobScope scope() { return JobScope.TENANT; }
    @Override public boolean cancellable() { return false; }
    @Override public boolean retryable() { return true; }

    @Override
    public JobBatchResult executeBatch(JobExecutionContext context) {
        if (!context.tenantId().equals(UUID.fromString(operations.select(mapper::executeBatch)
                .map(String.class).single()))) throw new IllegalStateException("tenant context mismatch");
        Instant now = clock.instant();
        List<UUID> ledgerIds = operations.select(mapper::lockExpiredLedgers).param("now", Timestamp.from(now)).param("limit", BATCH_SIZE).map(UUID.class).list();
        if (!ledgerIds.isEmpty()) {
            operations.update(mapper::deleteLinkedAdjustments)
                    .param("ids", ledgerIds).execute();
            operations.update(mapper::deleteLedgers)
                    .param("ids", ledgerIds).param("now", Timestamp.from(now)).execute();
        }
        int remaining = BATCH_SIZE - ledgerIds.size();
        List<UUID> adjustmentIds = remaining == 0 ? List.of() : operations.select(mapper::lockExpiredAdjustments).param("now", Timestamp.from(now)).param("limit", remaining).map(UUID.class).list();
        if (!adjustmentIds.isEmpty()) {
            operations.update(mapper::deleteAdjustments)
                    .param("ids", adjustmentIds).param("now", Timestamp.from(now)).execute();
        }
        int processed = ledgerIds.size() + adjustmentIds.size();
        return processed == BATCH_SIZE ? JobBatchResult.more(processed) : JobBatchResult.completed(processed);
    }
}
