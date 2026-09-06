package com.mybill.admin.user;

import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

import static com.mybill.admin.user.AdminUserContracts.CreateUserRequest;
import static com.mybill.admin.user.AdminUserContracts.TemporaryCredential;
import static com.mybill.admin.user.AdminUserContracts.UserPage;
import static com.mybill.admin.user.AdminUserContracts.VersionRequest;

@Validated
@RestController
@RequestMapping("/api/v1/admin/users")
public class AdminUserController {
    private final AdminUserService service;

    AdminUserController(AdminUserService service) {
        this.service = service;
    }

    @GetMapping
    UserPage list(@RequestParam(defaultValue = "") @Size(max = 64) String query,
                  @RequestParam(required = false) AdminUserStatus status,
                  @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
                  @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return service.list(query, status, page, size);
    }

    @PostMapping
    TemporaryCredential create(@AuthenticationPrincipal CurrentPrincipal administrator,
                               @Valid @RequestBody CreateUserRequest request) {
        return service.create(administrator, request.username());
    }

    @PostMapping("/{userId}/disable")
    AdminUserResponse disable(@AuthenticationPrincipal CurrentPrincipal administrator,
                              @PathVariable UUID userId, @Valid @RequestBody VersionRequest request) {
        return service.disable(administrator, userId, request.version());
    }

    @PostMapping("/{userId}/restore")
    AdminUserResponse restore(@AuthenticationPrincipal CurrentPrincipal administrator,
                              @PathVariable UUID userId, @Valid @RequestBody VersionRequest request) {
        return service.restore(administrator, userId, request.version());
    }

    @PostMapping("/{userId}/reset-password")
    TemporaryCredential resetPassword(@AuthenticationPrincipal CurrentPrincipal administrator,
                                      @PathVariable UUID userId, @Valid @RequestBody VersionRequest request) {
        return service.resetPassword(administrator, userId, request.version());
    }

}
