package com.mybill.admin.user;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

final class AdminUserContracts {
    private AdminUserContracts() { }

    record CreateUserRequest(
            @NotNull
            @Size(min = 3, max = 64)
            @Pattern(regexp = "^[!-~]+$", message = "用户名只允许 3-64 位可见 ASCII 字符")
            String username
    ) { }

    record VersionRequest(@Min(1) long version) { }

    record UserPage(List<AdminUserResponse> items, long total, int page, int size) { }

    record TemporaryCredential(AdminUserResponse user, String temporaryPassword, Instant expiresAt) { }
}
