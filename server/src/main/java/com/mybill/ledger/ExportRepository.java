package com.mybill.ledger;

import com.mybill.ledger.ExportContracts.ExportResponse;
import com.mybill.ledger.ExportContracts.ExportSnapshot;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
class ExportRepository {
    private final JdbcClient jdbc;

    ExportRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    void create(UUID id, UUID userId, String snapshotJson, Instant expiresAt, Instant now) {
        jdbc.sql("""
                INSERT INTO export_job(tenant_id,id,user_id,filter_snapshot,status,expires_at,created_at,updated_at)
                VALUES(current_setting('app.tenant_id')::uuid,:id,:userId,CAST(:snapshot AS jsonb),'PENDING',:expiresAt,:now,:now)
                """).param("id", id).param("userId", userId).param("snapshot", snapshotJson)
                .param("expiresAt", Timestamp.from(expiresAt)).param("now", Timestamp.from(now)).update();
    }

    Optional<Row> findOwned(UUID id, UUID userId) {
        return jdbc.sql("""
                SELECT e.*,e.filter_snapshot->>'scope' AS export_scope,
                       j.id AS run_id,j.status AS run_status,j.processed_count
                  FROM export_job e
                  LEFT JOIN job_run j ON j.tenant_id=e.tenant_id AND j.job_type='GENERATE_PERSONAL_EXPORT'
                    AND j.batch_key=e.id::text
                 WHERE e.id=:id AND e.user_id=:userId
                """).param("id", id).param("userId", userId).query(this::map).optional();
    }

    Optional<JobRow> findForJob(UUID id) {
        return jdbc.sql("SELECT user_id,filter_snapshot::text,expires_at,status,file_location FROM export_job WHERE id=:id FOR UPDATE")
                .param("id", id).query((rs, row) -> new JobRow(rs.getObject(1, UUID.class), rs.getString(2),
                        instant(rs, 3), rs.getString(4), rs.getString(5))).optional();
    }

    boolean markRunning(UUID id, Instant now) {
        return jdbc.sql("UPDATE export_job SET status='RUNNING',error_summary=NULL,updated_at=:now WHERE id=:id AND status='PENDING' AND expires_at>:now")
                .param("id", id).param("now", Timestamp.from(now)).update() == 1;
    }

    void markSucceeded(UUID id, String location, Instant now) {
        requireOne(jdbc.sql("UPDATE export_job SET status='SUCCEEDED',file_location=:location,error_summary=NULL,updated_at=:now WHERE id=:id AND status='RUNNING' AND expires_at>:now")
                .param("id", id).param("location", location).param("now", Timestamp.from(now)).update());
    }

    void markFailed(UUID id, String summary, Instant now) {
        jdbc.sql("UPDATE export_job SET status='FAILED',file_location=NULL,error_summary=:summary,updated_at=:now WHERE id=:id AND status='RUNNING'")
                .param("id", id).param("summary", summary).param("now", Timestamp.from(now)).update();
    }

    void markCancelled(UUID id, Instant now) {
        jdbc.sql("UPDATE export_job SET status='CANCELLED',file_location=NULL,error_summary=NULL,updated_at=:now WHERE id=:id AND status IN ('PENDING','RUNNING')")
                .param("id", id).param("now", Timestamp.from(now)).update();
    }

    void markExpired(UUID id, Instant now) {
        jdbc.sql("UPDATE export_job SET status='EXPIRED',file_location=NULL,error_summary=NULL,updated_at=:now WHERE id=:id AND status<>'EXPIRED' AND expires_at<=:now")
                .param("id", id).param("now", Timestamp.from(now)).update();
    }

    ExportResponse response(Row row, Instant now) {
        String status = row.status();
        if (status.equals("SUCCEEDED") && "RUNNING".equals(row.runStatus())) status = "RUNNING";
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

    private Row map(ResultSet rs, int number) throws SQLException {
        return new Row(rs.getObject("id", UUID.class), rs.getString("export_scope"), rs.getString("status"),
                rs.getString("run_status"), rs.getLong("processed_count"), instant(rs, "created_at"),
                instant(rs, "expires_at"), rs.getString("error_summary"), rs.getString("file_location"),
                rs.getObject("run_id", UUID.class));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column); return value == null ? null : value.toInstant();
    }
    private static Instant instant(ResultSet rs, int column) throws SQLException {
        Timestamp value = rs.getTimestamp(column); return value == null ? null : value.toInstant();
    }
    private static void requireOne(int count) { if (count != 1) throw new IllegalStateException("export state changed"); }

    record Row(UUID id, String scope, String status, String runStatus, long rowCount, Instant createdAt,
               Instant expiresAt, String errorSummary, String fileLocation, UUID runId) { }
    record JobRow(UUID userId, String snapshotJson, Instant expiresAt, String status, String fileLocation) { }
}
