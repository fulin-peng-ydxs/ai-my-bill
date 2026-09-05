package com.mybill.auth;

import java.security.Principal;
import java.util.UUID;

/** 服务端认证后的唯一身份事实；租户标识永不从客户端参数取得。 */
public record CurrentPrincipal(
        UUID sessionId,
        UUID userId,
        UUID tenantId,
        long credentialVersion,
        String username,
        Role role,
        boolean passwordChangeRequired
) implements Principal {

    public enum Role {
        ADMIN,
        USER
    }

    @Override
    public String getName() {
        return username;
    }

    public UUID requireTenantId() {
        if (tenantId == null || role != Role.USER) {
            throw new IllegalStateException("当前身份没有个人租户上下文");
        }
        return tenantId;
    }
}
