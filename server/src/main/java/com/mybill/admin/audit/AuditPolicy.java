package com.mybill.admin.audit;

import java.util.Set;
import java.util.regex.Pattern;

/** 一个管理动作允许进入审计摘要的稳定字段白名单。 */
public record AuditPolicy(String action, String objectType, Set<String> allowedFields) {
    private static final Pattern CODE = Pattern.compile("[A-Z][A-Z0-9_]{0,63}");

    public AuditPolicy {
        if (!CODE.matcher(action == null ? "" : action).matches()
                || !CODE.matcher(objectType == null ? "" : objectType).matches()) {
            throw new IllegalArgumentException("audit action and objectType must be uppercase stable codes");
        }
        allowedFields = allowedFields == null ? Set.of() : Set.copyOf(allowedFields);
        if (allowedFields.size() > 32 || allowedFields.stream().anyMatch(AuditSummarySanitizer::isSensitiveKey)) {
            throw new IllegalArgumentException("audit field whitelist is unsafe");
        }
    }
}
