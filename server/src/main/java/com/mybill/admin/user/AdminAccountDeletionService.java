package com.mybill.admin.user;

import com.mybill.account.AccountDeletionContracts.DeletionResult;
import com.mybill.account.AccountDeletionService;
import com.mybill.admin.audit.AdminAuditService;
import com.mybill.admin.audit.AuditEvent;
import com.mybill.admin.audit.AuditPolicy;
import com.mybill.admin.audit.AuditResult;
import com.mybill.auth.CurrentPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class AdminAccountDeletionService {
    private static final AuditPolicy POLICY = new AuditPolicy(
            "DELETE_USER_ACCOUNT", "ACCOUNT_DELETION", Set.of("status"));

    private final AccountDeletionService deletionService;
    private final AdminAuditService auditService;

    public AdminAccountDeletionService(AccountDeletionService deletionService, AdminAuditService auditService) {
        this.deletionService = deletionService;
        this.auditService = auditService;
    }

    @Transactional
    public DeletionResult delete(CurrentPrincipal administrator, UUID userId, long version) {
        DeletionResult result = deletionService.deleteByAdministrator(administrator, userId, version);
        auditService.append(administrator, POLICY, new AuditEvent(result.deletionReference().toString(),
                AuditResult.SUCCEEDED, Map.of(), Map.of("status", "DELETED")));
        return result;
    }
}
