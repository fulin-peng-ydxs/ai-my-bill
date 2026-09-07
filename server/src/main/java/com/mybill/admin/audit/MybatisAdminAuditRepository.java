package com.mybill.admin.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;

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

    private String json(AdminAuditRecord record) {
        try {
            return objectMapper.writeValueAsString(record.safeSummary());
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("audit summary is not serializable", exception);
        }
    }
}
