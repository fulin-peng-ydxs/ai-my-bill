package com.mybill.shared.api;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ApiErrorTest {

    @Test
    void keepsTheStableExternalShape() {
        ApiError error = new ApiError("INVALID_REQUEST", "输入无效", Map.of(), "trace-1", false);

        assertThat(error.code()).isEqualTo("INVALID_REQUEST");
        assertThat(error.message()).isEqualTo("输入无效");
        assertThat(error.fieldErrors()).isEmpty();
        assertThat(error.traceId()).isEqualTo("trace-1");
        assertThat(error.retryable()).isFalse();
    }
}
