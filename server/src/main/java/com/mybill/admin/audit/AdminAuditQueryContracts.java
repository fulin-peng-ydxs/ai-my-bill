package com.mybill.admin.audit;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class AdminAuditQueryContracts {
    private AdminAuditQueryContracts() { }

    enum Period { ALL, TODAY, LAST_7_DAYS, LAST_30_DAYS }

    record AuditLogItem(UUID id, String administrator, String action, String objectType,
                        String objectId, AuditResult result, Map<String, Object> safeSummary,
                        Instant occurredAt) { }

    record AuditLogPage(List<AuditLogItem> items, long total, int page, int size) { }
}
