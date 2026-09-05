package com.mybill.auth;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 认证域唯一的数据访问入口；查询结果严格限制为身份、会话和限流字段。 */
@Repository
public class AuthRepository {

    private final JdbcClient jdbc;

    public AuthRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<AuthUser> findUserByUsername(String username) {
        return jdbc.sql("""
                        SELECT u.id, u.username, u.password_digest, u.temporary_password_expires_at,
                               u.role, u.status, u.tenant_id, u.credential_version, t.status AS tenant_status
                        FROM app_user u
                        LEFT JOIN tenant t ON t.id = u.tenant_id
                        WHERE u.username = :username
                        """)
                .param("username", username)
                .query(AuthRepository::mapUser)
                .optional();
    }

    Optional<AuthUser> findUserById(UUID userId) {
        return jdbc.sql("""
                        SELECT u.id, u.username, u.password_digest, u.temporary_password_expires_at,
                               u.role, u.status, u.tenant_id, u.credential_version, t.status AS tenant_status
                        FROM app_user u
                        LEFT JOIN tenant t ON t.id = u.tenant_id
                        WHERE u.id = :userId
                        """)
                .param("userId", userId)
                .query(AuthRepository::mapUser)
                .optional();
    }

    Optional<SessionIdentity> findSession(String tokenDigest) {
        return jdbc.sql("""
                        SELECT s.id AS session_id, s.user_id, s.credential_version AS session_credential_version,
                               s.expires_at, s.revoked_at, u.username, u.role, u.status,
                               u.tenant_id, u.credential_version AS user_credential_version,
                               u.temporary_password_expires_at, t.status AS tenant_status
                        FROM user_session s
                        JOIN app_user u ON u.id = s.user_id
                        LEFT JOIN tenant t ON t.id = u.tenant_id
                        WHERE s.token_digest = :tokenDigest
                        """)
                .param("tokenDigest", tokenDigest)
                .query((rs, rowNum) -> new SessionIdentity(
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
        jdbc.sql("""
                        INSERT INTO user_session(
                            id, user_id, token_digest, credential_version, expires_at, last_used_at, created_at
                        ) VALUES (:id, :userId, :tokenDigest, :credentialVersion, :expiresAt, :now, :now)
                        """)
                .param("id", sessionId)
                .param("userId", userId)
                .param("tokenDigest", tokenDigest)
                .param("credentialVersion", credentialVersion)
                .param("expiresAt", sqlTimestamp(expiresAt))
                .param("now", sqlTimestamp(now))
                .update();
    }

    void touchSession(UUID sessionId, UUID userId, Instant now) {
        jdbc.sql("""
                        UPDATE user_session SET last_used_at = :now
                        WHERE id = :sessionId AND last_used_at < :touchBefore
                        """)
                .param("now", sqlTimestamp(now))
                .param("sessionId", sessionId)
                .param("touchBefore", sqlTimestamp(now.minusSeconds(300)))
                .update();
        jdbc.sql("""
                        UPDATE app_user SET last_active_at = :now
                        WHERE id = :userId AND (last_active_at IS NULL OR last_active_at < :touchBefore)
                        """)
                .param("now", sqlTimestamp(now))
                .param("userId", userId)
                .param("touchBefore", sqlTimestamp(now.minusSeconds(300)))
                .update();
    }

    void revokeSession(UUID sessionId, Instant now, String reason) {
        jdbc.sql("""
                        UPDATE user_session
                        SET revoked_at = :now, revoked_reason = :reason
                        WHERE id = :sessionId AND revoked_at IS NULL
                        """)
                .param("now", sqlTimestamp(now))
                .param("reason", reason)
                .param("sessionId", sessionId)
                .update();
    }

    void revokeAllSessions(UUID userId, Instant now, String reason) {
        jdbc.sql("""
                        UPDATE user_session
                        SET revoked_at = :now, revoked_reason = :reason
                        WHERE user_id = :userId AND revoked_at IS NULL
                        """)
                .param("now", sqlTimestamp(now))
                .param("reason", reason)
                .param("userId", userId)
                .update();
    }

    long replacePassword(UUID userId, long expectedVersion, String passwordDigest, Instant now) {
        return jdbc.sql("""
                        UPDATE app_user
                        SET password_digest = :passwordDigest,
                            temporary_password_expires_at = NULL,
                            credential_version = credential_version + 1,
                            updated_at = :now
                        WHERE id = :userId AND credential_version = :expectedVersion
                        RETURNING credential_version
                        """)
                .param("passwordDigest", passwordDigest)
                .param("now", sqlTimestamp(now))
                .param("userId", userId)
                .param("expectedVersion", expectedVersion)
                .query(Long.class)
                .optional()
                .orElse(0L);
    }

    void ensureRateLimitRow(String subjectDigest, Instant windowStart, Instant now) {
        jdbc.sql("""
                        INSERT INTO auth_rate_limit(id, entry_point, subject_digest, window_started_at, updated_at)
                        VALUES (:id, 'LOGIN', :subjectDigest, :windowStart, :now)
                        ON CONFLICT (entry_point, subject_digest, window_started_at) DO NOTHING
                        """)
                .param("id", UUID.randomUUID())
                .param("subjectDigest", subjectDigest)
                .param("windowStart", sqlTimestamp(windowStart))
                .param("now", sqlTimestamp(now))
                .update();
    }

    boolean hasActiveLoginLock(String subjectDigest, Instant now) {
        return jdbc.sql("""
                        SELECT EXISTS (
                            SELECT 1
                            FROM auth_rate_limit
                            WHERE entry_point = 'LOGIN' AND subject_digest = :subjectDigest
                              AND locked_until > :now
                        )
                        """)
                .param("subjectDigest", subjectDigest)
                .param("now", sqlTimestamp(now))
                .query(Boolean.class)
                .single();
    }

    RateLimitState lockRateLimit(String subjectDigest, Instant windowStart) {
        return jdbc.sql("""
                        SELECT failure_count, locked_until
                        FROM auth_rate_limit
                        WHERE entry_point = 'LOGIN' AND subject_digest = :subjectDigest
                          AND window_started_at = :windowStart
                        FOR UPDATE
                        """)
                .param("subjectDigest", subjectDigest)
                .param("windowStart", sqlTimestamp(windowStart))
                .query((rs, rowNum) -> new RateLimitState(
                        rs.getInt("failure_count"), timestamp(rs.getTimestamp("locked_until"))))
                .single();
    }

    void recordFailure(String subjectDigest, Instant windowStart, int failures, Instant lockedUntil, Instant now) {
        jdbc.sql("""
                        UPDATE auth_rate_limit
                        SET failure_count = :failures, locked_until = :lockedUntil, updated_at = :now
                        WHERE entry_point = 'LOGIN' AND subject_digest = :subjectDigest
                          AND window_started_at = :windowStart
                        """)
                .param("failures", failures)
                .param("lockedUntil", sqlTimestamp(lockedUntil))
                .param("now", sqlTimestamp(now))
                .param("subjectDigest", subjectDigest)
                .param("windowStart", sqlTimestamp(windowStart))
                .update();
    }

    void clearLoginFailures(String subjectDigest) {
        jdbc.sql("DELETE FROM auth_rate_limit WHERE entry_point = 'LOGIN' AND subject_digest = :subjectDigest")
                .param("subjectDigest", subjectDigest)
                .update();
    }

    private static AuthUser mapUser(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
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
