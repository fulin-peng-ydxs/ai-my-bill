package com.mybill.persistence.model;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import java.util.UUID;

/** MyBatis-Plus 对身份表的结构映射。 */
final class IdentityEntities {
    private IdentityEntities() {
    }
}

@TableName("tenant")
class TenantEntity {
    @TableId UUID id;
    @TableField String status;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected TenantEntity() { }
}

@TableName("app_user")
class AppUserEntity {
    @TableId UUID id;
    @TableField String username;
    @TableField("password_digest") String passwordDigest;
    @TableField("temporary_password_expires_at") Instant temporaryPasswordExpiresAt;
    @TableField String role;
    @TableField String status;
    @TableField("tenant_id") UUID tenantId;
    @TableField("credential_version") long credentialVersion;
    @TableField("last_active_at") Instant lastActiveAt;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected AppUserEntity() { }
}

@TableName("user_session")
class UserSessionEntity {
    @TableId UUID id;
    @TableField("user_id") UUID userId;
    @TableField("token_digest") String tokenDigest;
    @TableField("credential_version") long credentialVersion;
    @TableField("expires_at") Instant expiresAt;
    @TableField("revoked_at") Instant revokedAt;
    @TableField("revoked_reason") String revokedReason;
    @TableField("last_used_at") Instant lastUsedAt;
    @TableField("created_at") Instant createdAt;
    protected UserSessionEntity() { }
}

@TableName("auth_rate_limit")
class AuthRateLimitEntity {
    @TableId UUID id;
    @TableField("entry_point") String entryPoint;
    @TableField("subject_digest") String subjectDigest;
    @TableField("window_started_at") Instant windowStartedAt;
    @TableField("failure_count") int failureCount;
    @TableField("locked_until") Instant lockedUntil;
    @TableField("updated_at") Instant updatedAt;
    protected AuthRateLimitEntity() { }
}
