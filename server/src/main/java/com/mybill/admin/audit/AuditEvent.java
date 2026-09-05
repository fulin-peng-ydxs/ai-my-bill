package com.mybill.admin.audit;

import java.util.Map;
import java.util.Collections;
import java.util.LinkedHashMap;

public record AuditEvent(String objectId, AuditResult result, Map<String, ?> before, Map<String, ?> after) {
    public AuditEvent {
        if (objectId == null || objectId.isBlank() || objectId.length() > 128 || result == null) {
            throw new IllegalArgumentException("invalid audit event");
        }
        before = before == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(before));
        after = after == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(after));
    }
}
