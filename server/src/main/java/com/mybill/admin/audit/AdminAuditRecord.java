package com.mybill.admin.audit;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record AdminAuditRecord(UUID id, UUID administratorUserId, String action, String objectType,
                               String objectId, AuditResult result, Map<String, Object> safeSummary,
                               Instant occurredAt) { }
