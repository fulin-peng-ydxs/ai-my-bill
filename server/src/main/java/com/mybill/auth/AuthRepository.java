package com.mybill.auth;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 认证域唯一的数据访问入口；查询结果严格限制为身份、会话和限流字段。 */
@Repository
public class AuthRepository {

    private final MybatisOperations operations;
    private final AuthRepositoryMapper mapper;

    public AuthRepository(MybatisOperations operations, AuthRepositoryMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    Optional<AuthUser> findUserByUsername(String username) {
        return operations.select(mapper::findUserByUsername)
                .param("username", username)
                .map(AuthRepository::mapUser)
                .optional();
    }

    Optional<AuthUser> findUserById(UUID userId) {
        return operations.select(mapper::findUserById)
                .param("userId", userId)
                .map(AuthRepository::mapUser)
                .optional();
    }

    Optional<SessionIdentity> findSession(String tokenDigest) {
        return operations.select(mapper::findSession)
                .param("tokenDigest", tokenDigest)
                .map((rs, rowNum) -> new SessionIdentity(
                        rs.getObject("session_id", UUID.class),
                        rs.getObject("user_id", UUID.class),
                        rs.getLong("session_credential_version"),
                        rs.getTimestamp("expires_at").toInstant(),
                        timestamp(rs.getTimestamp("revoked_at")),
                        rs.getString("username"),
                        CurrentPrincipal.Role.valueOf(rs.getString("role")),
                        rs.getString("status"),
                        rs.getObject("tenant_id", UUID.class),
                        rs.getLong("user_credential_version"),
                        timestamp(rs.getTimestamp("temporary_password_expires_at")),
                        rs.getString("tenant_status")))
                .optional();
    }

    void createSession(UUID sessionId, UUID userId, String tokenDigest, long credentialVersion,
                       Instant expiresAt, Instant now) {
        operations.update(mapper::createSession)
                .param("id", sessionId)
                .param("userId", userId)
                .param("tokenDigest", tokenDigest)
                .param("credentialVersion", credentialVersion)
                .param("expiresAt", sqlTimestamp(expiresAt))
                .param("now", sqlTimestamp(now))
                .execute();
    }

    void touchSession(UUID sessionId, UUID userId, Instant now) {
        operations.update(mapper::touchSession)
                .param("now", sqlTimestamp(now))
                .param("sessionId", sessionId)
                .param("touchBefore", sqlTimestamp(now.minusSeconds(300)))
                .execute();
        operations.update(mapper::touchUserActivity)
                .param("now", sqlTimestamp(now))
                .param("userId", userId)
                .param("touchBefore", sqlTimestamp(now.minusSeconds(300)))
                .execute();
    }

    void revokeSession(UUID sessionId, Instant now, String reason) {
        operations.update(mapper::revokeSession)
                .param("now", sqlTimestamp(now))
                .param("reason", reason)
                .param("sessionId", sessionId)
                .execute();
    }

    void revokeAllSessions(UUID userId, Instant now, String reason) {
        operations.update(mapper::revokeAllSessions)
                .param("now", sqlTimestamp(now))
                .param("reason", reason)
                .param("userId", userId)
                .execute();
    }

    long replacePassword(UUID userId, long expectedVersion, String passwordDigest, Instant now) {
        return operations.select(mapper::replacePassword)
                .param("passwordDigest", passwordDigest)
                .param("now", sqlTimestamp(now))
                .param("userId", userId)
                .param("expectedVersion", expectedVersion)
                .map(Long.class)
                .optional()
                .orElse(0L);
    }

    void ensureRateLimitRow(String subjectDigest, Instant windowStart, Instant now) {
        operations.update(mapper::ensureRateLimitRow)
                .param("id", UUID.randomUUID())
                .param("subjectDigest", subjectDigest)
                .param("windowStart", sqlTimestamp(windowStart))
                .param("now", sqlTimestamp(now))
                .execute();
    }

    boolean hasActiveLoginLock(String subjectDigest, Instant now) {
        return operations.select(mapper::hasActiveLoginLock)
                .param("subjectDigest", subjectDigest)
                .param("now", sqlTimestamp(now))
                .map(Boolean.class)
                .single();
    }

    RateLimitState lockRateLimit(String subjectDigest, Instant windowStart) {
        return operations.select(mapper::lockRateLimit)
                .param("subjectDigest", subjectDigest)
                .param("windowStart", sqlTimestamp(windowStart))
                .map((rs, rowNum) -> new RateLimitState(
                        rs.getInt("failure_count"), timestamp(rs.getTimestamp("locked_until"))))
                .single();
    }

    void recordFailure(String subjectDigest, Instant windowStart, int failures, Instant lockedUntil, Instant now) {
        operations.update(mapper::recordFailure)
                .param("failures", failures)
                .param("lockedUntil", sqlTimestamp(lockedUntil))
                .param("now", sqlTimestamp(now))
                .param("subjectDigest", subjectDigest)
                .param("windowStart", sqlTimestamp(windowStart))
                .execute();
    }

    void clearLoginFailures(String subjectDigest) {
        operations.update(mapper::clearLoginFailures)
                .param("subjectDigest", subjectDigest)
                .execute();
    }

    private static AuthUser mapUser(com.mybill.shared.persistence.DatabaseRow rs, int rowNum) throws java.sql.SQLException {
        return new AuthUser(
                rs.getObject("id", UUID.class),
                rs.getString("username"),
                rs.getString("password_digest"),
                timestamp(rs.getTimestamp("temporary_password_expires_at")),
                CurrentPrincipal.Role.valueOf(rs.getString("role")),
                rs.getString("status"),
                rs.getObject("tenant_id", UUID.class),
                rs.getLong("credential_version"),
                rs.getString("tenant_status"));
    }

    private static Instant timestamp(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static Timestamp sqlTimestamp(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    record AuthUser(UUID id, String username, String passwordDigest, Instant temporaryPasswordExpiresAt,
                    CurrentPrincipal.Role role, String status, UUID tenantId, long credentialVersion,
                    String tenantStatus) { }

    record SessionIdentity(UUID sessionId, UUID userId, long sessionCredentialVersion, Instant expiresAt,
                           Instant revokedAt, String username, CurrentPrincipal.Role role, String userStatus,
                           UUID tenantId, long userCredentialVersion, Instant temporaryPasswordExpiresAt,
                           String tenantStatus) { }

    record RateLimitState(int failureCount, Instant lockedUntil) { }
}
