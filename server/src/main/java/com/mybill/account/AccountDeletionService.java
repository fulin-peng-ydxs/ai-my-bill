package com.mybill.account;

import com.mybill.account.AccountDeletionContracts.DeletionResult;
import com.mybill.auth.CurrentPrincipal;
import com.mybill.job.JobCoordinator;
import com.mybill.ledger.PersonalExportDeletionService;
import com.mybill.shared.api.ApiException;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

@Service
public class AccountDeletionService {
    private static final Duration AUDIT_RETENTION = Duration.ofDays(180);
    private final AccountDeletionRepository repository;
    private final TenantDatabaseExecutor tenantDatabase;
    private final PersonalExportDeletionService exportFiles;
    private final JobCoordinator jobs;
    private final Clock clock;

    AccountDeletionService(AccountDeletionRepository repository, TenantDatabaseExecutor tenantDatabase,
                           PersonalExportDeletionService exportFiles, JobCoordinator jobs, Clock clock) {
        this.repository = repository; this.tenantDatabase = tenantDatabase; this.exportFiles = exportFiles;
        this.jobs = jobs; this.clock = clock;
    }

    @Transactional
    public DeletionResult deleteSelf(CurrentPrincipal principal, String confirmation) {
        if (principal.role() != CurrentPrincipal.Role.USER) throw forbidden();
        AccountDeletionRepository.UserRow user = requireUser(principal.userId());
        if (!user.username().equals(confirmation)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DELETION_CONFIRMATION_MISMATCH",
                    "请输入当前用户名以确认注销。", false,
                    Map.of("confirmation", java.util.List.of("用户名不匹配")));
        }
        return erase(user, "SELF");
    }

    @Transactional
    public DeletionResult deleteByAdministrator(CurrentPrincipal administrator, UUID userId, long version) {
        if (administrator.role() != CurrentPrincipal.Role.ADMIN) throw forbidden();
        AccountDeletionRepository.UserRow user = requireUser(userId);
        if (user.version() != version) {
            throw new ApiException(HttpStatus.CONFLICT, "USER_VERSION_CONFLICT",
                    "用户状态已发生变化，请刷新后重试。", false);
        }
        return erase(user, "ADMIN");
    }

    private DeletionResult erase(AccountDeletionRepository.UserRow user, String actorType) {
        if ("DELETION_PENDING".equals(user.status())) {
            throw new ApiException(HttpStatus.CONFLICT, "ACCOUNT_DELETION_IN_PROGRESS",
                    "账号正在注销，请勿重复提交。", false);
        }
        Instant now = clock.instant();
        Instant expiresAt = now.plus(AUDIT_RETENTION);
        UUID reference = UUID.randomUUID();
        tenantDatabase.execute(user.tenantId(), () -> {
            var exportLocations = repository.exportLocations(user.id());
            repository.insertDeletionJob(reference, user.id(), now);
            repository.insertAudit(reference, actorType, AccountDeletionFingerprint.of(user.id()), now, expiresAt);
            repository.eraseTenant(user.tenantId(), user.id(), reference);
            // 文件先移入同目录隔离名；数据库回滚时恢复，提交后才物理删除，避免失败造成半注销。
            exportFiles.deleteFilesAfterCommit(exportLocations, reference);
            return null;
        });
        jobs.scheduleAt(ExpiredAccountDeletionAuditJob.TYPE, null,
                expiresAt.truncatedTo(ChronoUnit.MINUTES).toString(), expiresAt);
        return new DeletionResult(reference, now, expiresAt);
    }

    /** 仅供离线恢复工具使用；沿用原匿名审计，不延长保留期，不生成新的用户身份。 */
    @Transactional
    void replayDeletion(UUID userId, UUID auditReference) {
        var restored = repository.lockUser(userId);
        if (restored.isEmpty()) return;
        var user = restored.get();
        tenantDatabase.execute(user.tenantId(), () -> {
            var locations = repository.exportLocations(user.id());
            repository.eraseTenant(user.tenantId(), user.id(), auditReference);
            exportFiles.deleteFilesAfterCommit(locations, auditReference);
            return null;
        });
    }

    private AccountDeletionRepository.UserRow requireUser(UUID userId) {
        return repository.lockUser(userId).orElseThrow(() -> new ApiException(
                HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "用户不存在。", false));
    }

    private static ApiException forbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "无权执行该操作。", false);
    }
}
