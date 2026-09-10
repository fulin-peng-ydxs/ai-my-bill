package com.mybill.job;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class MybatisJobRunRepository implements JobRunRepository {
    private final MybatisOperations operations;
    private final JobRunRepositoryMapper mapper;

    public MybatisJobRunRepository(MybatisOperations operations, JobRunRepositoryMapper mapper) { this.operations = operations; this.mapper = mapper; }

    @Override
    @Transactional
    public UUID schedule(String type, UUID tenantId, String batchKey, int maxAttempts,
                         Instant availableAt, Instant now) {
        validate(type, batchKey, maxAttempts);
        if (availableAt == null) throw new IllegalArgumentException("availableAt is required");
        UUID id = UUID.randomUUID();
        operations.update(mapper::schedule).param("id", id).param("tenantId", tenantId).param("type", type).param("availableAt", ts(availableAt))
                .param("batchKey", batchKey).param("maxAttempts", maxAttempts).param("now", ts(now)).execute();
        return operations.select(mapper::findScheduledId)
                .param("type", type).param("tenantId", tenantId).param("batchKey", batchKey)
                .map(UUID.class).single();
    }

    @Override
    public Optional<JobRun> find(UUID id) {
        return operations.select(mapper::find).param("id", id).map(this::map).optional();
    }

    @Override
    @Transactional
    public Optional<JobRun> claimNext(Collection<String> types, String owner, Instant now, Instant leaseUntil) {
        if (types == null || types.isEmpty()) return Optional.empty();
        return operations.select(mapper::claimNext).param("types", types).param("owner", owner).param("now", ts(now))
                .param("leaseUntil", ts(leaseUntil)).map(this::map).optional();
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean renew(UUID id, String owner, Instant now, Instant leaseUntil) {
        return operations.update(mapper::renew)
                .param("until", ts(leaseUntil)).param("now", ts(now)).param("id", id).param("owner", owner).execute() == 1;
    }

    @Override
    public boolean isCancellationRequested(UUID id, String owner) {
        return operations.select(mapper::isCancellationRequested)
                .param("id", id).param("owner", owner).map(Boolean.class).optional().orElse(false);
    }

    @Override public void complete(UUID id, String owner, long count, Instant now) {
        terminal(id, owner, "SUCCEEDED", false, count, null, now);
    }
    @Override public void cancel(UUID id, String owner, long count, Instant now) {
        terminal(id, owner, "CANCELLED", true, count, null, now);
    }

    @Override
    public void releaseForMore(UUID id, String owner, long count, Instant now) {
        requireOne(operations.update(mapper::releaseForMore).param("count", count).param("now", ts(now)).param("id", id).param("owner", owner).execute());
    }

    @Override
    public void failOrRetry(UUID id, String owner, boolean retry, String error, Instant now) {
        String status = retry ? "PENDING" : "FAILED";
        int changed = operations.update(mapper::failOrRetry).param("status", status).param("retry", retry).param("now", ts(now)).param("error", error)
                .param("id", id).param("owner", owner).execute();
        requireOne(changed);
    }

    @Override
    public List<JobRun> findExpired(Instant now) {
        return operations.select(mapper::findExpired)
                .param("now", ts(now)).map(this::map).list();
    }

    @Override
    public boolean recoverExpired(UUID id, boolean retry, String error, Instant now) {
        return operations.update(mapper::recoverExpired).param("retry", retry).param("now", ts(now)).param("error", error).param("id", id).execute() == 1;
    }

    @Override
    @Transactional
    public String requestCancellation(UUID id, boolean cancellable, Instant now) {
        String status = operations.select(mapper::requestCancellation).param("id", id)
                .map(String.class).optional().orElseThrow(() -> new IllegalArgumentException("job run not found"));
        if (!cancellable && (status.equals("PENDING") || status.equals("RUNNING"))) {
            throw new IllegalStateException("任务当前类型不支持取消");
        }
        if (status.equals("PENDING")) {
            operations.update(mapper::cancelPending)
                    .param("now", ts(now)).param("id", id).execute();
            return "CANCELLED";
        }
        if (status.equals("RUNNING")) {
            operations.update(mapper::requestRunningCancellation)
                    .param("now", ts(now)).param("id", id).execute();
            return "CANCEL_REQUESTED";
        }
        return status;
    }

    private void terminal(UUID id, String owner, String status, boolean cancellationRequested,
                          long count, String error, Instant now) {
        requireOne(operations.update(mapper::terminal).param("status", status)
                .param("cancellationRequested", cancellationRequested).param("count", count)
                .param("now", ts(now)).param("error", error)
                .param("id", id).param("owner", owner).execute());
    }

    private JobRun map(DatabaseRow rs, int row) throws SQLException {
        return new JobRun(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class), rs.getString("job_type"),
                rs.getString("batch_key"), rs.getString("status"), rs.getLong("processed_count"),
                rs.getInt("attempt_count"), rs.getInt("max_attempts"), rs.getString("lease_owner"),
                rs.getObject("lease_expires_at", java.time.OffsetDateTime.class) == null ? null
                        : rs.getObject("lease_expires_at", java.time.OffsetDateTime.class).toInstant(),
                rs.getBoolean("cancel_requested"));
    }

    private static void validate(String type, String key, int attempts) {
        if (type == null || !type.matches("[A-Z][A-Z0-9_]{0,63}") || key == null || key.isBlank()
                || key.length() > 128 || attempts < 1 || attempts > 20) throw new IllegalArgumentException("invalid job schedule");
    }
    private static void requireOne(int count) { if (count != 1) throw new JobLeaseLostException(); }
    private static Timestamp ts(Instant value) { return Timestamp.from(value); }
}
