package com.mybill.admin.overview;

import com.mybill.shared.persistence.DatabaseRow;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;

@Repository
class AdminOverviewRepository {
    private final MybatisOperations operations;
    private final AdminOverviewRepositoryMapper mapper;

    AdminOverviewRepository(MybatisOperations operations, AdminOverviewRepositoryMapper mapper) {
        this.operations = operations;
        this.mapper = mapper;
    }

    OverviewRow overview() {
        return operations.select(mapper::overview).map(AdminOverviewRepository::map).single();
    }

    private static OverviewRow map(DatabaseRow row, int rowNumber) {
        return new OverviewRow(row.getLong("total_users"), row.getLong("active_users"),
                row.getLong("pending_users"), row.getLong("disabled_users"),
                row.getLong("deletion_pending_users"), row.getLong("active_sessions"),
                instant(row.getTimestamp("last_active_at")),
                row.getLong("database_bytes"));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    record OverviewRow(long total, long active, long pendingFirstLogin, long disabled,
                       long deletionPending, long activeSessions, Instant lastActiveAt,
                       long databaseBytes) { }
}
