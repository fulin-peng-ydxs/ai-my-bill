package com.mybill.admin.user;

import java.time.Instant;
import java.util.UUID;

/** 管理员可见的账号白名单 DTO；不得加入租户标识或任何账目领域字段。 */
record AdminUserResponse(
        UUID accountId,
        String username,
        AdminUserStatus status,
        Instant registeredAt,
        Instant lastActiveAt,
        Instant temporaryPasswordExpiresAt,
        long version
) {
    static AdminUserResponse from(AdminUserRepository.AdminUserRow row) {
        AdminUserStatus visibleStatus = switch (row.status()) {
            case "ACTIVE" -> row.temporaryPasswordExpiresAt() == null
                    ? AdminUserStatus.ACTIVE : AdminUserStatus.PENDING_FIRST_LOGIN;
            case "DISABLED" -> AdminUserStatus.DISABLED;
            case "DELETION_PENDING" -> AdminUserStatus.DELETION_PENDING;
            default -> throw new IllegalStateException("不支持的普通用户状态");
        };
        return new AdminUserResponse(row.id(), row.username(), visibleStatus, row.createdAt(),
                row.lastActiveAt(), row.temporaryPasswordExpiresAt(), row.credentialVersion());
    }
}
