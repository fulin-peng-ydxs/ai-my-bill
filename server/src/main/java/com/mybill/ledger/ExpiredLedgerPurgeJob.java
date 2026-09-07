package com.mybill.ledger;

import com.mybill.job.JobBatchResult;
import com.mybill.job.JobDefinition;
import com.mybill.job.JobExecutionContext;
import com.mybill.job.JobScope;
import org.springframework.jdbc.core.simple.JdbcClient;
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
    private final JdbcClient jdbc;
    private final Clock clock;

    ExpiredLedgerPurgeJob(JdbcClient jdbc, Clock clock) { this.jdbc = jdbc; this.clock = clock; }

    @Override public String jobType() { return TYPE; }
    @Override public JobScope scope() { return JobScope.TENANT; }
    @Override public boolean cancellable() { return false; }
    @Override public boolean retryable() { return true; }

    @Override
    public JobBatchResult executeBatch(JobExecutionContext context) {
        if (!context.tenantId().equals(UUID.fromString(jdbc.sql("SELECT current_setting('app.tenant_id')")
                .query(String.class).single()))) throw new IllegalStateException("tenant context mismatch");
        Instant now = clock.instant();
        List<UUID> ledgerIds = jdbc.sql("""
                SELECT id FROM ledger_entry
                 WHERE lifecycle_status='TRASHED' AND purge_after<=:now
                 ORDER BY purge_after,id FOR UPDATE SKIP LOCKED LIMIT :limit
                """).param("now", Timestamp.from(now)).param("limit", BATCH_SIZE).query(UUID.class).list();
        if (!ledgerIds.isEmpty()) {
            jdbc.sql("DELETE FROM expense_adjustment WHERE original_expense_id IN (:ids)")
                    .param("ids", ledgerIds).update();
            jdbc.sql("DELETE FROM ledger_entry WHERE id IN (:ids) AND lifecycle_status='TRASHED' AND purge_after<=:now")
                    .param("ids", ledgerIds).param("now", Timestamp.from(now)).update();
        }
        int remaining = BATCH_SIZE - ledgerIds.size();
        List<UUID> adjustmentIds = remaining == 0 ? List.of() : jdbc.sql("""
                SELECT id FROM expense_adjustment
                 WHERE status='TRASHED' AND purge_after<=:now
                 ORDER BY purge_after,id FOR UPDATE SKIP LOCKED LIMIT :limit
                """).param("now", Timestamp.from(now)).param("limit", remaining).query(UUID.class).list();
        if (!adjustmentIds.isEmpty()) {
            jdbc.sql("DELETE FROM expense_adjustment WHERE id IN (:ids) AND status='TRASHED' AND purge_after<=:now")
                    .param("ids", adjustmentIds).param("now", Timestamp.from(now)).update();
        }
        int processed = ledgerIds.size() + adjustmentIds.size();
        return processed == BATCH_SIZE ? JobBatchResult.more(processed) : JobBatchResult.completed(processed);
    }
}
