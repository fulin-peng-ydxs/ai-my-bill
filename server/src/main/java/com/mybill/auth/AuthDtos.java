package com.mybill.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 认证 API 的窄 DTO 集合，禁止客户端提交用户 ID、角色或租户。 */
final class AuthDtos {
    private AuthDtos() { }
}

record LoginRequest(
        @NotBlank @Size(min = 3, max = 64) @Pattern(regexp = "^[!-~]+$") String username,
        @NotBlank @Size(max = 128) String password
) { }

record FirstPasswordRequest(@NotBlank @Size(max = 128) String newPassword) { }

record PasswordChangeRequest(
        @NotBlank @Size(max = 128) String currentPassword,
        @NotBlank @Size(max = 128) String newPassword
) { }

record SessionResponse(String accountId, String username, String role, boolean passwordChangeRequired) {
    static SessionResponse from(CurrentPrincipal principal) {
        return new SessionResponse(
                principal.userId().toString(),
                principal.username(),
                principal.role().name(),
                principal.passwordChangeRequired()
        );
    }
}
