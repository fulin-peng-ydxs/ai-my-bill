package com.mybill.ledger;

import com.mybill.ledger.ExportContracts.ExportResponse;
import com.mybill.ledger.ExportContracts.ExportSnapshot;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
class ExportRepository {
    private final MybatisOperations operations;
    private final ExportRepositoryMapper mapper;

    ExportRepository(MybatisOperations operations, ExportRepositoryMapper mapper) { this.operations = operations; this.mapper = mapper; }

    void create(UUID id, UUID userId, String snapshotJson, Instant expiresAt, Instant now) {
        operations.update(mapper::create).param("id", id).param("userId", userId).param("snapshot", snapshotJson)
                .param("expiresAt", Timestamp.from(expiresAt)).param("now", Timestamp.from(now)).execute();
    }

    Optional<Row> findOwned(UUID id, UUID userId) {
        return operations.select(mapper::findOwned).param("id", id).param("userId", userId).map(this::map).optional();
    }

    Optional<JobRow> findForJob(UUID id) {
        return operations.select(mapper::findForJob)
                .param("id", id).map((rs, row) -> new JobRow(rs.getObject("user_id", UUID.class),
                        rs.getString("filter_snapshot"), instant(rs, "expires_at"), rs.getString("status"),
                        rs.getString("file_location"))).optional();
    }

    boolean markRunning(UUID id, Instant now) {
        return operations.update(mapper::markRunning)
                .param("id", id).param("now", Timestamp.from(now)).execute() == 1;
    }

    void markSucceeded(UUID id, String location, Instant now) {
        requireOne(operations.update(mapper::markSucceeded)
                .param("id", id).param("location", location).param("now", Timestamp.from(now)).execute());
    }

    void markFailed(UUID id, String summary, Instant now) {
        operations.update(mapper::markFailed)
                .param("id", id).param("summary", summary).param("now", Timestamp.from(now)).execute();
    }

    void markCancelled(UUID id, Instant now) {
        operations.update(mapper::markCancelled)
                .param("id", id).param("now", Timestamp.from(now)).execute();
    }

    void clearCancelledFileLocation(UUID id, Instant now) {
        operations.update(mapper::clearCancelledFileLocation)
                .param("id", id).param("now", Timestamp.from(now)).execute();
    }

    void markExpired(UUID id, Instant now) {
        operations.update(mapper::markExpired)
                .param("id", id).param("now", Timestamp.from(now)).execute();
    }

    ExportResponse response(Row row, Instant now) {
        String status = row.status();
        if ("CANCELLED".equals(row.runStatus())) status = "CANCELLED";
        else if (status.equals("SUCCEEDED") && "RUNNING".equals(row.runStatus())) status = "RUNNING";
        else if ((status.equals("PENDING") || status.equals("RUNNING")) && row.runStatus() != null) {
            status = switch (row.runStatus()) {
                case "RUNNING" -> "RUNNING";
                case "FAILED" -> "FAILED";
                case "CANCELLED" -> "CANCELLED";
                default -> status;
            };
        }
        if (!status.equals("EXPIRED") && !row.expiresAt().isAfter(now)) status = "EXPIRED";
        String error = status.equals("FAILED") ? "导出生成失败，请重试。" : row.errorSummary();
        String download = status.equals("SUCCEEDED") && row.rowCount() > 0
                ? "/api/v1/exports/" + row.id() + "/download" : null;
        return new ExportResponse(row.id(), row.scope(), status, row.rowCount(), row.createdAt(),
                row.expiresAt(), error, download);
    }

    private Row map(DatabaseRow rs, int number) throws SQLException {
        return new Row(rs.getObject("id", UUID.class), rs.getString("export_scope"), rs.getString("status"),
                rs.getString("run_status"), rs.getLong("processed_count"), instant(rs, "created_at"),
                instant(rs, "expires_at"), rs.getString("error_summary"), rs.getString("file_location"),
                rs.getObject("run_id", UUID.class));
    }

    private static Instant instant(DatabaseRow rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column); return value == null ? null : value.toInstant();
    }
    private static void requireOne(int count) { if (count != 1) throw new IllegalStateException("export state changed"); }

    record Row(UUID id, String scope, String status, String runStatus, long rowCount, Instant createdAt,
               Instant expiresAt, String errorSummary, String fileLocation, UUID runId) { }
    record JobRow(UUID userId, String snapshotJson, Instant expiresAt, String status, String fileLocation) { }
}
