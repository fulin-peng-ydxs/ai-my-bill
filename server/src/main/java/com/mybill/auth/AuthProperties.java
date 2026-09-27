package com.mybill.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

/** T3 认证安全参数；生产机密通过环境变量注入，非机密阈值可按部署容量调整。 */
@ConfigurationProperties("my-bill.auth")
public record AuthProperties(
        @DefaultValue("MY_BILL_SESSION") String sessionCookieName,
        @DefaultValue("PT12H") Duration sessionDuration,
        @DefaultValue("false") boolean secureCookie,
        @DefaultValue("12") int bcryptStrength,
        @DefaultValue("PT15M") Duration rateLimitWindow,
        @DefaultValue("5") int maxLoginFailures,
        @DefaultValue("50") int maxSourceLoginFailures,
        @DefaultValue("PT15M") Duration loginLockDuration,
        @DefaultValue("my-bill-local-rate-limit-pepper") String rateLimitPepper,
        @DefaultValue("") String rateLimitPepperFile
) {
    public AuthProperties {
        if (sessionCookieName == null || sessionCookieName.isBlank()) {
            throw new IllegalArgumentException("session cookie name must not be blank");
        }
        if (sessionDuration == null || sessionDuration.isNegative() || sessionDuration.isZero()) {
            throw new IllegalArgumentException("session duration must be positive");
        }
        if (bcryptStrength < 10 || bcryptStrength > 16) {
            throw new IllegalArgumentException("bcrypt strength must be between 10 and 16");
        }
        if (rateLimitWindow == null || rateLimitWindow.isNegative() || rateLimitWindow.isZero()
                || loginLockDuration == null || loginLockDuration.isNegative() || loginLockDuration.isZero()) {
            throw new IllegalArgumentException("rate limit durations must be positive");
        }
        boolean hasInlinePepper = rateLimitPepper != null && rateLimitPepper.length() >= 16;
        boolean hasPepperFile = rateLimitPepperFile != null && !rateLimitPepperFile.isBlank();
        if (maxLoginFailures < 2 || maxSourceLoginFailures < maxLoginFailures
                || (!hasInlinePepper && !hasPepperFile)) {
            throw new IllegalArgumentException("rate limit configuration is unsafe");
        }
    }
}
