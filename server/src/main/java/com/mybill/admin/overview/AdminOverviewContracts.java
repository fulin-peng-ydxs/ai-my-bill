package com.mybill.admin.overview;

import java.time.Instant;

final class AdminOverviewContracts {
    private AdminOverviewContracts() { }

    enum HealthStatus { HEALTHY }
    enum BackupStatus { UNCONFIGURED, SUCCEEDED, FAILED, RUNNING, STALE, UNAVAILABLE }

    record AccountOverview(long total, long active, long pendingFirstLogin,
                           long disabled, long deletionPending, long activeSessions,
                           Instant lastActiveAt) { }

    record ServiceOverview(HealthStatus status, Instant checkedAt) { }

    /** 宿主备份状态及最后成功时间；成功不代表已完成业务恢复验收。 */
    record BackupOverview(BackupStatus status, Instant latestCompletedAt) { }

    record StorageOverview(long databaseBytes) { }

    /** 严格限定为账号和服务元数据，不得加入任何账目字段或聚合。 */
    record AdminOverview(AccountOverview accounts, ServiceOverview service,
                         BackupOverview backup, StorageOverview storage) { }
}
