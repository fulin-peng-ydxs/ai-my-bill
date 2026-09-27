package com.mybill.account;

import com.mybill.ledger.PersonalExportDeletionService;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** 重启后按数据库权威状态收敛账号注销过程中遗留的隔离导出文件。 */
@Service
public final class AccountDeletionFileRecovery {
    private final PersonalExportDeletionService exportFiles;
    private final TenantDatabaseExecutor tenantDatabase;
    private final AccountDeletionRepository repository;

    AccountDeletionFileRecovery(PersonalExportDeletionService exportFiles, TenantDatabaseExecutor tenantDatabase,
                                AccountDeletionRepository repository) {
        this.exportFiles = exportFiles; this.tenantDatabase = tenantDatabase; this.repository = repository;
    }

    public int recover() {
        return exportFiles.recoverInterruptedDeletions(this::exportStillRegistered);
    }

    private boolean exportStillRegistered(UUID tenantId, String location) {
        return tenantDatabase.execute(tenantId, () -> repository.exportLocationExists(location));
    }
}
