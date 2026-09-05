package com.mybill.admin.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AuditSummarySanitizerTest {
    private final AuditSummarySanitizer sanitizer = new AuditSummarySanitizer(new ObjectMapper());

    @Test
    void recordsOnlyChangedWhitelistedFieldsAndRecursivelyRemovesSecrets() {
        AuditPolicy policy = new AuditPolicy("UPDATE_CONFIG", "SYSTEM_CONFIG", Set.of("name", "settings"));
        AuditEvent event = new AuditEvent("config-1", AuditResult.SUCCEEDED,
                Map.of("name", "same", "ignored", "old", "settings", Map.of("theme", "light", "nested",
                        List.of(Map.of("accessToken", "old-token", "latitude", 31.2, "visible", "before")))),
                Map.of("name", "same", "ignored", "new", "settings", Map.of("theme", "dark", "nested",
                        List.of(Map.of("accessToken", "new-token", "latitude", 32.1, "visible", "after")))));

        String json = new ObjectMapper().valueToTree(sanitizer.changedFields(policy, event)).toString();

        assertThat(json).contains("settings", "theme", "visible", "before", "after")
                .doesNotContain("ignored", "name", "accessToken", "token", "latitude");
    }

    @Test
    void rejectsSensitiveFieldsInPolicy() {
        assertThatThrownBy(() -> new AuditPolicy("RESET_USER", "USER", Set.of("passwordHash")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
