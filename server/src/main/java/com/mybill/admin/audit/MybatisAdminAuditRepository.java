package com.mybill.admin.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class MybatisAdminAuditRepository implements AdminAuditRepository {
    private final MybatisOperations operations;
    private final AdminAuditRepositoryMapper mapper;
    private final ObjectMapper objectMapper;

    public MybatisAdminAuditRepository(MybatisOperations operations, AdminAuditRepositoryMapper mapper,
                                       ObjectMapper objectMapper) {
        this.operations = operations; this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    @Override
    public void append(AdminAuditRecord record) {
        operations.update(mapper::append)
                .param("id", record.id()).param("administrator", record.administratorUserId())
                .param("action", record.action()).param("objectType", record.objectType())
                .param("objectId", record.objectId()).param("result", record.result().name())
                .param("summary", json(record)).param("occurredAt", Timestamp.from(record.occurredAt())).execute();
    }

    @Override
    public List<AdminAuditQueryRow> find(AdminAuditQuery query) {
        return bind(operations.select(mapper::find), query)
                .map((row, number) -> new AdminAuditQueryRow(row.getObject("id", UUID.class),
                        row.getString("administrator"), row.getString("action"), row.getString("object_type"),
                        row.getString("object_id"), AuditResult.valueOf(row.getString("result")),
                        summary(row.getString("safe_summary")), row.getTimestamp("occurred_at").toInstant()))
                .list();
    }

    @Override
    public long count(AdminAuditQuery query) {
        return bind(operations.select(mapper::count), query).map(Long.class).single();
    }

    private MybatisOperations.SelectSpec bind(MybatisOperations.SelectSpec select, AdminAuditQuery query) {
        return select.param("administrator", contains(query.administrator()))
                .param("action", contains(query.action())).param("object", contains(query.object()))
                .param("result", query.result() == null ? null : query.result().name())
                .param("startAt", query.startAt() == null ? null : Timestamp.from(query.startAt()))
                .param("limit", query.limit()).param("offset", query.offset());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> summary(String json) {
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("stored audit summary is invalid", exception);
        }
    }

    private static String contains(String value) {
        if (value == null || value.isEmpty()) return "";
        return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private String json(AdminAuditRecord record) {
        try {
            return objectMapper.writeValueAsString(record.safeSummary());
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("audit summary is not serializable", exception);
        }
    }
}
