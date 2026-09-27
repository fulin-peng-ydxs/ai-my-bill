package com.mybill.admin.overview;

import java.time.Instant;

final class AdminOverviewContracts {
    private AdminOverviewContracts() { }

    enum HealthStatus { HEALTHY }
    enum BackupStatus { UNCONFIGURED }

    record AccountOverview(long total, long active, long pendingFirstLogin,
                           long disabled, long deletionPending, long activeSessions,
                           Instant lastActiveAt) { }

    record ServiceOverview(HealthStatus status, Instant checkedAt) { }

    /** T29 接入真实备份运行状态前只能明确返回未配置。 */
    record BackupOverview(BackupStatus status, Instant latestCompletedAt) { }

    record StorageOverview(long databaseBytes) { }

    /** 严格限定为账号和服务元数据，不得加入任何账目字段或聚合。 */
    record AdminOverview(AccountOverview accounts, ServiceOverview service,
                         BackupOverview backup, StorageOverview storage) { }
}
