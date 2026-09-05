package com.mybill.job;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class JdbcJobRunRepository implements JobRunRepository {
    private final JdbcClient jdbc;

    public JdbcJobRunRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Override
    @Transactional
    public UUID schedule(String type, UUID tenantId, String batchKey, int maxAttempts, Instant now) {
        validate(type, batchKey, maxAttempts);
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO job_run(id, tenant_id, job_type, batch_key, status, max_attempts, created_at, updated_at)
                VALUES (:id, :tenantId, :type, :batchKey, 'PENDING', :maxAttempts, :now, :now)
                ON CONFLICT DO NOTHING
                """).param("id", id).param("tenantId", tenantId).param("type", type)
                .param("batchKey", batchKey).param("maxAttempts", maxAttempts).param("now", ts(now)).update();
        return jdbc.sql("SELECT id FROM job_run WHERE job_type=:type AND tenant_id IS NOT DISTINCT FROM :tenantId AND batch_key=:batchKey")
                .param("type", type).param("tenantId", tenantId).param("batchKey", batchKey)
                .query(UUID.class).single();
    }

    @Override
    public Optional<JobRun> find(UUID id) {
        return jdbc.sql("SELECT * FROM job_run WHERE id=:id").param("id", id).query(this::map).optional();
    }

    @Override
    @Transactional
    public Optional<JobRun> claimNext(Collection<String> types, String owner, Instant now, Instant leaseUntil) {
        if (types == null || types.isEmpty()) return Optional.empty();
        return jdbc.sql("""
                WITH candidate AS (
                    SELECT id FROM job_run
                    WHERE status='PENDING' AND batch_key IS NOT NULL
                      AND attempt_count < max_attempts AND job_type IN (:types)
                    ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
                )
                UPDATE job_run j SET status='RUNNING', started_at=COALESCE(started_at,:now),
                    attempt_count=attempt_count+1, lease_owner=:owner, lease_expires_at=:leaseUntil,
                    cancel_requested=false, updated_at=:now
                FROM candidate WHERE j.id=candidate.id
                RETURNING j.*
                """).param("types", types).param("owner", owner).param("now", ts(now))
                .param("leaseUntil", ts(leaseUntil)).query(this::map).optional();
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean renew(UUID id, String owner, Instant now, Instant leaseUntil) {
        return jdbc.sql("UPDATE job_run SET lease_expires_at=:until, updated_at=:now WHERE id=:id AND status='RUNNING' AND lease_owner=:owner")
                .param("until", ts(leaseUntil)).param("now", ts(now)).param("id", id).param("owner", owner).update() == 1;
    }

    @Override
    public boolean isCancellationRequested(UUID id, String owner) {
        return jdbc.sql("SELECT cancel_requested FROM job_run WHERE id=:id AND status='RUNNING' AND lease_owner=:owner")
                .param("id", id).param("owner", owner).query(Boolean.class).optional().orElse(false);
    }

    @Override public void complete(UUID id, String owner, long count, Instant now) {
        terminal(id, owner, "SUCCEEDED", count, null, now);
    }
    @Override public void cancel(UUID id, String owner, long count, Instant now) {
        terminal(id, owner, "CANCELLED", count, null, now);
    }

    @Override
    public void releaseForMore(UUID id, String owner, long count, Instant now) {
        requireOne(jdbc.sql("""
                UPDATE job_run SET status='PENDING', processed_count=processed_count+:count, attempt_count=0,
                    lease_owner=NULL, lease_expires_at=NULL, cancel_requested=false, error_summary=NULL, updated_at=:now
                WHERE id=:id AND status='RUNNING' AND lease_owner=:owner
                """).param("count", count).param("now", ts(now)).param("id", id).param("owner", owner).update());
    }

    @Override
    public void failOrRetry(UUID id, String owner, boolean retry, String error, Instant now) {
        String status = retry ? "PENDING" : "FAILED";
        int changed = jdbc.sql("""
                UPDATE job_run SET status=:status, finished_at=CASE WHEN :retry THEN NULL::timestamptz ELSE :now END,
                    error_summary=:error, lease_owner=NULL, lease_expires_at=NULL, cancel_requested=false, updated_at=:now
                WHERE id=:id AND status='RUNNING' AND lease_owner=:owner
                """).param("status", status).param("retry", retry).param("now", ts(now)).param("error", error)
                .param("id", id).param("owner", owner).update();
        requireOne(changed);
    }

    @Override
    public List<JobRun> findExpired(Instant now) {
        return jdbc.sql("SELECT * FROM job_run WHERE status='RUNNING' AND lease_expires_at <= :now ORDER BY created_at, id LIMIT 100")
                .param("now", ts(now)).query(this::map).list();
    }

    @Override
    public void recoverExpired(UUID id, boolean retry, String error, Instant now) {
        jdbc.sql("""
                UPDATE job_run SET status=CASE WHEN :retry THEN 'PENDING' ELSE 'FAILED' END,
                    finished_at=CASE WHEN :retry THEN NULL::timestamptz ELSE :now END, error_summary=:error,
                    lease_owner=NULL, lease_expires_at=NULL, cancel_requested=false, updated_at=:now
                WHERE id=:id AND status='RUNNING' AND lease_expires_at <= :now
                """).param("retry", retry).param("now", ts(now)).param("error", error).param("id", id).update();
    }

    @Override
    @Transactional
    public String requestCancellation(UUID id, boolean cancellable, Instant now) {
        String status = jdbc.sql("SELECT status FROM job_run WHERE id=:id FOR UPDATE").param("id", id)
                .query(String.class).optional().orElseThrow(() -> new IllegalArgumentException("job run not found"));
        if (!cancellable && (status.equals("PENDING") || status.equals("RUNNING"))) {
            throw new IllegalStateException("任务当前类型不支持取消");
        }
        if (status.equals("PENDING")) {
            jdbc.sql("UPDATE job_run SET status='CANCELLED', started_at=:now, finished_at=:now, updated_at=:now WHERE id=:id")
                    .param("now", ts(now)).param("id", id).update();
            return "CANCELLED";
        }
        if (status.equals("RUNNING")) {
            jdbc.sql("UPDATE job_run SET cancel_requested=true, updated_at=:now WHERE id=:id")
                    .param("now", ts(now)).param("id", id).update();
            return "CANCEL_REQUESTED";
        }
        return status;
    }

    private void terminal(UUID id, String owner, String status, long count, String error, Instant now) {
        requireOne(jdbc.sql("""
                UPDATE job_run SET status=:status, processed_count=processed_count+:count, finished_at=:now,
                    error_summary=:error, lease_owner=NULL, lease_expires_at=NULL, cancel_requested=false, updated_at=:now
                WHERE id=:id AND status='RUNNING' AND lease_owner=:owner
                """).param("status", status).param("count", count).param("now", ts(now)).param("error", error)
                .param("id", id).param("owner", owner).update());
    }

    private JobRun map(ResultSet rs, int row) throws SQLException {
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
    private static void requireOne(int count) { if (count != 1) throw new IllegalStateException("任务租约已失效"); }
    private static Timestamp ts(Instant value) { return Timestamp.from(value); }
}
