package com.mybill.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.shared.api.ApiError;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

/** Security Filter 链的错误响应写入器，保持与 Controller 相同的 ApiError 合同。 */
@Component
final class SecurityErrorWriter {

    private final ObjectMapper objectMapper;

    SecurityErrorWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    void write(HttpServletResponse response, int status, String code, String message, boolean retryable)
            throws IOException {
        if (response.isCommitted()) {
            return;
        }
        String traceId = MDC.get("traceId");
        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString();
        }
        response.setStatus(status);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        objectMapper.writeValue(response.getOutputStream(),
                new ApiError(code, message, Map.of(), traceId, retryable));
    }
}
