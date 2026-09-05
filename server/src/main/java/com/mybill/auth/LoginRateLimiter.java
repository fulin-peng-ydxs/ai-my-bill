package com.mybill.auth;

import com.mybill.auth.AuthRepository.RateLimitState;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

/**
 * 数据库登录限流。失败计数使用独立事务，确保外层认证返回 401 时不会回滚安全状态。
 */
@Service
public class LoginRateLimiter {

    private final AuthRepository repository;
    private final AuthProperties properties;
    private final RateLimitSubjectHasher subjectHasher;
    private final Clock clock;

    LoginRateLimiter(AuthRepository repository, AuthProperties properties,
                     RateLimitSubjectHasher subjectHasher, Clock clock) {
        this.repository = repository;
        this.properties = properties;
        this.subjectHasher = subjectHasher;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void assertAllowed(String username) {
        Instant now = clock.instant();
        String subject = subjectHasher.digest(username);
        Instant windowStart = windowStart(now);
        repository.ensureRateLimitRow(subject, windowStart, now);
        RateLimitState state = repository.lockRateLimit(subject, windowStart);
        if (state.lockedUntil() != null && state.lockedUntil().isAfter(now)) {
            throw rateLimited();
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(String username) {
        Instant now = clock.instant();
        String subject = subjectHasher.digest(username);
        Instant windowStart = windowStart(now);
        repository.ensureRateLimitRow(subject, windowStart, now);
        RateLimitState state = repository.lockRateLimit(subject, windowStart);
        int failures = state.failureCount() + 1;
        Instant lockedUntil = failures >= properties.maxLoginFailures()
                ? now.plus(properties.loginLockDuration()) : null;
        repository.recordFailure(subject, windowStart, failures, lockedUntil, now);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void clear(String username) {
        repository.clearLoginFailures(subjectHasher.digest(username));
    }

    private Instant windowStart(Instant now) {
        long windowSeconds = properties.rateLimitWindow().toSeconds();
        return Instant.ofEpochSecond((now.getEpochSecond() / windowSeconds) * windowSeconds);
    }

    private ApiException rateLimited() {
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "LOGIN_RATE_LIMITED",
                "登录尝试过于频繁，请稍后再试。", true);
    }
}
