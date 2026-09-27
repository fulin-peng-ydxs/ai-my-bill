package com.mybill.ledger;

import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Collection;
import java.util.UUID;
import java.util.function.BiPredicate;

/** 账号注销协调器使用的导出文件清理边界；路径始终再次经过导出根目录 containment 校验。 */
@Service
public final class PersonalExportDeletionService {
    private final ExportFileStore files;

    PersonalExportDeletionService(ExportFileStore files) { this.files = files; }

    public void deleteFilesAfterCommit(Collection<String> locations, UUID deletionReference) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()
                || !TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new IllegalStateException("export deletion staging requires an active transaction");
        }
        locations.forEach(files::validateLocation);
        ExportFileStore.StagedDeletion staged = files.stageDeletion(locations, deletionReference);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                files.completeDeletion(staged);
            }

            @Override
            public void afterCompletion(int status) {
                if (status != STATUS_COMMITTED) files.restoreDeletion(staged);
            }
        });
    }

    /**
     * 收敛进程在文件隔离后中断留下的文件：数据库仍登记该导出则恢复，否则完成物理删除。
     */
    public int recoverInterruptedDeletions(BiPredicate<UUID, String> exportStillRegistered) {
        int recovered = 0;
        for (ExportFileStore.StagedFile file : files.interruptedDeletions()) {
            boolean registered = exportStillRegistered.test(files.tenantId(file), file.original().toString());
            files.recoverInterruptedDeletion(file, registered);
            recovered++;
        }
        return recovered;
    }
}
