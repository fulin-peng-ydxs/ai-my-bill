package com.mybill.shared.logging;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/** Log completion inside TraceIdFilter; never log literal URLs, query strings or request bodies. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public final class RequestLogFilter extends OncePerRequestFilter {
    private static final Logger LOG = LoggerFactory.getLogger(RequestLogFilter.class);

    public static String route(HttpServletRequest request) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        return pattern instanceof String value ? value : "UNMATCHED";
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long started = System.nanoTime();
        boolean completed = false;
        try {
            chain.doFilter(request, response);
            completed = true;
        } finally {
            String route = route(request);
            if (!route.startsWith("/api/v1/health") && !route.equals("/api/v1/prometheus")) {
                LOG.info("event=request_completed method={} route={} status={} durationMs={}",
                        request.getMethod(), route, completed ? response.getStatus() : 500,
                        (System.nanoTime() - started) / 1_000_000);
            }
        }
    }
}
