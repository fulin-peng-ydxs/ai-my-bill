package com.mybill.admin.user;

import com.mybill.admin.audit.AdminAuditService;
import com.mybill.admin.audit.AuditEvent;
import com.mybill.admin.audit.AuditPolicy;
import com.mybill.admin.audit.AuditResult;
import com.mybill.auth.AuthenticationService;
import com.mybill.auth.CurrentPrincipal;
import com.mybill.shared.api.ApiException;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static com.mybill.admin.user.AdminUserContracts.TemporaryCredential;
import static com.mybill.admin.user.AdminUserContracts.UserPage;

/** 管理员用户生命周期事务；不读取或写入任何用户账目数据。 */
@Service
class AdminUserService {
    private static final Duration TEMPORARY_PASSWORD_LIFETIME = Duration.ofHours(24);
    private static final AuditPolicy CREATE_POLICY = new AuditPolicy("CREATE_USER", "USER", Set.of("username", "status"));
    private static final AuditPolicy STATUS_POLICY = new AuditPolicy("CHANGE_USER_STATUS", "USER", Set.of("status"));
    private static final AuditPolicy RESET_POLICY = new AuditPolicy("RESET_USER_PASSWORD", "USER", Set.of("status"));

    private final AdminUserRepository repository;
    private final TemporaryPasswordGenerator passwordGenerator;
    private final PasswordEncoder passwordEncoder;
    private final TenantDatabaseExecutor tenantDatabase;
    private final AuthenticationService authenticationService;
    private final AdminAuditService auditService;
    private final Clock clock;

    AdminUserService(AdminUserRepository repository, TemporaryPasswordGenerator passwordGenerator,
                     PasswordEncoder passwordEncoder, TenantDatabaseExecutor tenantDatabase,
                     AuthenticationService authenticationService, AdminAuditService auditService, Clock clock) {
        this.repository = repository;
        this.passwordGenerator = passwordGenerator;
        this.passwordEncoder = passwordEncoder;
        this.tenantDatabase = tenantDatabase;
        this.authenticationService = authenticationService;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    UserPage list(String query, AdminUserStatus status, int page, int size) {
        String normalizedQuery = escapeLike(query == null ? "" : query.strip());
        List<AdminUserResponse> users = repository.findUsers(normalizedQuery, status, size, page * size)
                .stream().map(AdminUserResponse::from).toList();
        return new UserPage(users, repository.countUsers(normalizedQuery, status), page, size);
    }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    @Transactional
    TemporaryCredential create(CurrentPrincipal administrator, String username) {
        Instant now = clock.instant();
        Instant expiresAt = now.plus(TEMPORARY_PASSWORD_LIFETIME);
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String temporaryPassword = passwordGenerator.generate();
        try {
            repository.createTenant(tenantId, now);
            repository.createUser(userId, tenantId, username, passwordEncoder.encode(temporaryPassword), expiresAt, now);
            tenantDatabase.execute(tenantId, () -> {
                repository.copyDefaultDictionaries(tenantId, now);
                return null;
            });
        } catch (DuplicateKeyException exception) {
            throw new ApiException(HttpStatus.CONFLICT, "USERNAME_ALREADY_EXISTS", "该用户名已存在。", false,
                    Map.of("username", List.of("该用户名已存在")));
        }
        AdminUserResponse user = AdminUserResponse.from(repository.findUser(userId));
        auditService.append(administrator, CREATE_POLICY, new AuditEvent(userId.toString(), AuditResult.SUCCEEDED,
                Map.of(), Map.of("username", username, "status", user.status().name())));
        return new TemporaryCredential(user, temporaryPassword, expiresAt);
    }

    @Transactional
    AdminUserResponse disable(CurrentPrincipal administrator, UUID userId, long version) {
        return changeStatus(administrator, userId, version, "ACTIVE", "DISABLED", "ADMIN_DISABLED", STATUS_POLICY);
    }

    @Transactional
    AdminUserResponse restore(CurrentPrincipal administrator, UUID userId, long version) {
        return changeStatus(administrator, userId, version, "DISABLED", "ACTIVE", "ADMIN_RESTORED", STATUS_POLICY);
    }

    @Transactional
    TemporaryCredential resetPassword(CurrentPrincipal administrator, UUID userId, long version) {
        AdminUserRepository.AdminUserRow before = lockAndCheckVersion(userId, version);
        if ("DELETION_PENDING".equals(before.status())) {
            throw invalidState("正在注销的账号不能重置密码。");
        }
        Instant now = clock.instant();
        Instant expiresAt = now.plus(TEMPORARY_PASSWORD_LIFETIME);
        String temporaryPassword = passwordGenerator.generate();
        requireSingleRow(repository.resetTemporaryPassword(
                userId, version, passwordEncoder.encode(temporaryPassword), expiresAt, now));
        authenticationService.revokeAllSessionsForAdministration(userId, now, "ADMIN_PASSWORD_RESET");
        AdminUserResponse user = AdminUserResponse.from(repository.findUser(userId));
        auditService.append(administrator, RESET_POLICY, new AuditEvent(userId.toString(), AuditResult.SUCCEEDED,
                Map.of("status", visibleStatus(before).name()), Map.of("status", user.status().name())));
        return new TemporaryCredential(user, temporaryPassword, expiresAt);
    }

    private AdminUserResponse changeStatus(CurrentPrincipal administrator, UUID userId, long version,
                                           String expectedStatus, String targetStatus, String revokeReason,
                                           AuditPolicy policy) {
        AdminUserRepository.AdminUserRow before = lockAndCheckVersion(userId, version);
        if (!expectedStatus.equals(before.status())) {
            throw invalidState("当前账号状态不能执行该操作。");
        }
        Instant now = clock.instant();
        requireSingleRow(repository.updateStatus(userId, version, targetStatus, now));
        requireSingleRow(repository.updateTenantStatus(
                before.tenantId(), "ACTIVE".equals(targetStatus) ? "ACTIVE" : "SUSPENDED", now));
        authenticationService.revokeAllSessionsForAdministration(userId, now, revokeReason);
        AdminUserResponse user = AdminUserResponse.from(repository.findUser(userId));
        auditService.append(administrator, policy, new AuditEvent(userId.toString(), AuditResult.SUCCEEDED,
                Map.of("status", visibleStatus(before).name()), Map.of("status", user.status().name())));
        return user;
    }

    private AdminUserRepository.AdminUserRow lockAndCheckVersion(UUID userId, long version) {
        AdminUserRepository.AdminUserRow row = repository.findUserForUpdate(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "用户不存在。", false));
        if (row.credentialVersion() != version) {
            throw new ApiException(HttpStatus.CONFLICT, "USER_VERSION_CONFLICT",
                    "用户状态已发生变化，请刷新后重试。", false);
        }
        return row;
    }

    private AdminUserStatus visibleStatus(AdminUserRepository.AdminUserRow row) {
        return AdminUserResponse.from(row).status();
    }

    private ApiException invalidState(String message) {
        return new ApiException(HttpStatus.CONFLICT, "USER_STATE_CONFLICT", message, false);
    }

    private void requireSingleRow(int affectedRows) {
        if (affectedRows != 1) {
            throw new IllegalStateException("账号生命周期写入未命中唯一记录");
        }
    }
}
