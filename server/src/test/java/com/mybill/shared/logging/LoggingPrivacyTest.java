package com.mybill.shared.logging;

import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxy;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.servlet.HandlerMapping;
import static org.assertj.core.api.Assertions.assertThat;

class LoggingPrivacyTest {
    @Test
    void bothFormatsKeepFramesWithoutSecretMessages() {
        RuntimeException failure = new RuntimeException("password=secret SQL account=private",
                new IllegalArgumentException("private ledger content"));
        failure.addSuppressed(new RuntimeException("token=secret"));
        LoggingEvent event = new LoggingEvent();
        event.setThrowableProxy(new ThrowableProxy(failure));
        for (String output : new String[]{new SafeThrowableConverter().convert(event),
                new SafeStackTracePrinter().printStackTraceToString(failure)}) {
            assertThat(output).contains("RuntimeException", "IllegalArgumentException", "LoggingPrivacyTest")
                    .doesNotContain("password", "private", "token", "SQL");
        }
    }

    @Test
    void routeNeverFallsBackToSensitiveUrl() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/ledger/private-id");
        request.setQueryString("token=secret");
        assertThat(RequestLogFilter.route(request)).isEqualTo("UNMATCHED");
        request.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/ledger/{id}");
        assertThat(RequestLogFilter.route(request)).isEqualTo("/ledger/{id}");
    }
}
