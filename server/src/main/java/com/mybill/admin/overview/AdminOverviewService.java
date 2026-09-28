package com.mybill.admin.overview;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

import static com.mybill.admin.overview.AdminOverviewContracts.AccountOverview;
import static com.mybill.admin.overview.AdminOverviewContracts.AdminOverview;
import static com.mybill.admin.overview.AdminOverviewContracts.HealthStatus;
import static com.mybill.admin.overview.AdminOverviewContracts.ServiceOverview;
import static com.mybill.admin.overview.AdminOverviewContracts.StorageOverview;

@Service
class AdminOverviewService {
    private final AdminOverviewRepository repository;
    private final Clock clock;
    private final BackupStatusReader backups;

    AdminOverviewService(AdminOverviewRepository repository, Clock clock, BackupStatusReader backups) {
        this.repository = repository;
        this.clock = clock;
        this.backups = backups;
    }

    @Transactional(readOnly = true)
    AdminOverview overview() {
        AdminOverviewRepository.OverviewRow row = repository.overview();
        Instant checkedAt = Instant.now(clock);
        return new AdminOverview(
                new AccountOverview(row.total(), row.active(), row.pendingFirstLogin(), row.disabled(),
                        row.deletionPending(), row.activeSessions(), row.lastActiveAt()),
                new ServiceOverview(HealthStatus.HEALTHY, checkedAt),
                backups.read(),
                new StorageOverview(row.databaseBytes()));
    }
}
