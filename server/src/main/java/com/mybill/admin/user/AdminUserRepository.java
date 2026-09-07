package com.mybill.admin.user;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 账号管理只访问身份、默认字典和注销任务表，查询中不接触账目领域。 */
@Repository
class AdminUserRepository {
    private static final long DEFAULT_DICTIONARY_LOCK = 7_204_918_330_117L;
    private final MybatisOperations operations;
    private final AdminUserRepositoryMapper mapper;

    AdminUserRepository(MybatisOperations operations, AdminUserRepositoryMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    List<AdminUserRow> findUsers(String query, AdminUserStatus status, int limit, int offset) {
        return operations.select(mapper::findUsers)
                .param("query", query)
                .param("requestedStatus", status == null ? null : status.name())
                .param("limit", limit)
                .param("offset", offset)
                .map(AdminUserRepository::mapRow)
                .list();
    }

    long countUsers(String query, AdminUserStatus status) {
        return operations.select(mapper::countUsers)
                .param("query", query)
                .param("requestedStatus", status == null ? null : status.name())
                .map(Long.class).single();
    }

    void createTenant(UUID tenantId, Instant now) {
        operations.update(mapper::createTenant)
                .param("id", tenantId).param("now", Timestamp.from(now)).execute();
    }

    void createUser(UUID userId, UUID tenantId, String username, String passwordDigest, Instant expiresAt, Instant now) {
        operations.update(mapper::createUser)
                .param("id", userId).param("tenantId", tenantId).param("username", username)
                .param("digest", passwordDigest).param("expiresAt", Timestamp.from(expiresAt))
                .param("now", Timestamp.from(now)).execute();
    }

    void copyDefaultDictionaries(UUID tenantId, Instant now) {
        operations.select(mapper::copyDefaultDictionaries)
                .param("lockId", DEFAULT_DICTIONARY_LOCK).map((rs, row) -> true).single();
        copySimple("UNIT", tenantId, now);
        copySimple("FUNDING_CHANNEL", tenantId, now);
        copySimple("PURCHASE_CHANNEL", tenantId, now);
        copySimple("INCOME_CATEGORY", tenantId, now);
        copyExpenseCategories(tenantId, now, true);
        copyExpenseCategories(tenantId, now, false);
    }

    private void copySimple(String type, UUID tenantId, Instant now) {
        operations.update(mapper::copySimple).param("tenantId", tenantId).param("type", type)
                .param("now", Timestamp.from(now)).execute();
    }

    private void copyExpenseCategories(UUID tenantId, Instant now, boolean roots) {
        operations.update(mapper::copyExpenseCategories)
                .param("tenantId", tenantId).param("roots", roots).param("now", Timestamp.from(now)).execute();
    }

    Optional<AdminUserRow> findUserForUpdate(UUID userId) {
        return operations.select(mapper::findUserForUpdate)
                .param("id", userId).map(AdminUserRepository::mapRow).optional();
    }

    AdminUserRow findUser(UUID userId) {
        return operations.select(mapper::findUser)
                .param("id", userId).map(AdminUserRepository::mapRow).single();
    }

    int updateStatus(UUID userId, long version, String status, Instant now) {
        return operations.update(mapper::updateStatus)
                .param("status", status).param("now", Timestamp.from(now))
                .param("id", userId).param("version", version).execute();
    }

    int updateTenantStatus(UUID tenantId, String status, Instant now) {
        return operations.update(mapper::updateTenantStatus)
                .param("status", status).param("now", Timestamp.from(now)).param("id", tenantId).execute();
    }

    int resetTemporaryPassword(UUID userId, long version, String digest, Instant expiresAt, Instant now) {
        return operations.update(mapper::resetTemporaryPassword)
                .param("digest", digest).param("expiresAt", Timestamp.from(expiresAt)).param("now", Timestamp.from(now))
                .param("id", userId).param("version", version).execute();
    }

    private static AdminUserRow mapRow(com.mybill.shared.persistence.DatabaseRow rs, int rowNumber) throws java.sql.SQLException {
        return new AdminUserRow(rs.getObject("id", UUID.class), rs.getString("username"), rs.getString("status"),
                instant(rs.getTimestamp("temporary_password_expires_at")), rs.getLong("credential_version"),
                instant(rs.getTimestamp("last_active_at")), rs.getTimestamp("created_at").toInstant(),
                rs.getObject("tenant_id", UUID.class));
    }

    private static Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    record AdminUserRow(UUID id, String username, String status, Instant temporaryPasswordExpiresAt,
                        long credentialVersion, Instant lastActiveAt, Instant createdAt, UUID tenantId) { }
}
