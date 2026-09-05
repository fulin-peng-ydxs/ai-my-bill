package com.mybill.admin.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;

@Repository
public class JdbcAdminAuditRepository implements AdminAuditRepository {
    private final JdbcClient jdbc;
    private final ObjectMapper mapper;

    public JdbcAdminAuditRepository(JdbcClient jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public void append(AdminAuditRecord record) {
        jdbc.sql("""
                INSERT INTO admin_audit_log(id, administrator_user_id, action, object_type,
                                            object_id, result, safe_summary, occurred_at)
                VALUES (:id, :administrator, :action, :objectType, :objectId, :result, CAST(:summary AS jsonb), :occurredAt)
                """)
                .param("id", record.id()).param("administrator", record.administratorUserId())
                .param("action", record.action()).param("objectType", record.objectType())
                .param("objectId", record.objectId()).param("result", record.result().name())
                .param("summary", json(record)).param("occurredAt", Timestamp.from(record.occurredAt())).update();
    }

    private String json(AdminAuditRecord record) {
        try {
            return mapper.writeValueAsString(record.safeSummary());
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("audit summary is not serializable", exception);
        }
    }
}
