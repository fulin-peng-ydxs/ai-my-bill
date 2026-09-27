package com.mybill.admin.audit;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

record AdminAuditQueryRow(UUID id, String administrator, String action, String objectType,
                          String objectId, AuditResult result, Map<String, Object> safeSummary,
                          Instant occurredAt) { }
