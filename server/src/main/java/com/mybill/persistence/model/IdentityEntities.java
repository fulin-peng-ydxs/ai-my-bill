package com.mybill.persistence.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** JPA 对身份表的结构映射；认证行为在 T3 实现。 */
final class IdentityEntities {
    private IdentityEntities() {
    }
}

@Entity
@Table(name = "tenant")
class TenantEntity {
    @Id UUID id;
    @Column(nullable = false, length = 16) String status;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected TenantEntity() { }
}

@Entity
@Table(name = "app_user")
class AppUserEntity {
    @Id UUID id;
    @Column(nullable = false, length = 64) String username;
    @Column(name = "password_digest", nullable = false) String passwordDigest;
    @Column(name = "temporary_password_expires_at") Instant temporaryPasswordExpiresAt;
    @Column(nullable = false, length = 16) String role;
    @Column(nullable = false, length = 16) String status;
    @Column(name = "tenant_id") UUID tenantId;
    @Column(name = "credential_version", nullable = false) long credentialVersion;
    @Column(name = "last_active_at") Instant lastActiveAt;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected AppUserEntity() { }
}

@Entity
@Table(name = "user_session")
class UserSessionEntity {
    @Id UUID id;
    @Column(name = "user_id", nullable = false) UUID userId;
    @Column(name = "token_digest", nullable = false) String tokenDigest;
    @Column(name = "credential_version", nullable = false) long credentialVersion;
    @Column(name = "expires_at", nullable = false) Instant expiresAt;
    @Column(name = "revoked_at") Instant revokedAt;
    @Column(name = "revoked_reason") String revokedReason;
    @Column(name = "last_used_at", nullable = false) Instant lastUsedAt;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    protected UserSessionEntity() { }
}

@Entity
@Table(name = "auth_rate_limit")
class AuthRateLimitEntity {
    @Id UUID id;
    @Column(name = "entry_point", nullable = false) String entryPoint;
    @Column(name = "subject_digest", nullable = false) String subjectDigest;
    @Column(name = "window_started_at", nullable = false) Instant windowStartedAt;
    @Column(name = "failure_count", nullable = false) int failureCount;
    @Column(name = "locked_until") Instant lockedUntil;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected AuthRateLimitEntity() { }
}
