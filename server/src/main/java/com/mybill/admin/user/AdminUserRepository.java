package com.mybill.admin.user;

import org.springframework.jdbc.core.simple.JdbcClient;
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
    private final JdbcClient jdbc;

    AdminUserRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<AdminUserRow> findUsers(String query, AdminUserStatus status, int limit, int offset) {
        return jdbc.sql("""
                        SELECT id, username, status, temporary_password_expires_at,
                               credential_version, last_active_at, created_at, tenant_id
                        FROM app_user
                        WHERE role = 'USER' AND status <> 'DELETED'
                          AND (:query = '' OR lower(username) LIKE ('%' || lower(:query) || '%') ESCAPE '\\')
                          AND (CAST(:requestedStatus AS varchar) IS NULL OR
                               (CAST(:requestedStatus AS varchar) = 'ACTIVE' AND status = 'ACTIVE' AND temporary_password_expires_at IS NULL) OR
                               (CAST(:requestedStatus AS varchar) = 'PENDING_FIRST_LOGIN' AND status = 'ACTIVE' AND temporary_password_expires_at IS NOT NULL) OR
                               (CAST(:requestedStatus AS varchar) = status AND status IN ('DISABLED', 'DELETION_PENDING')))
                        ORDER BY created_at DESC, id DESC
                        LIMIT :limit OFFSET :offset
                        """)
                .param("query", query)
                .param("requestedStatus", status == null ? null : status.name())
                .param("limit", limit)
                .param("offset", offset)
                .query(AdminUserRepository::mapRow)
                .list();
    }

    long countUsers(String query, AdminUserStatus status) {
        return jdbc.sql("""
                        SELECT count(*) FROM app_user
                        WHERE role = 'USER' AND status <> 'DELETED'
                          AND (:query = '' OR lower(username) LIKE ('%' || lower(:query) || '%') ESCAPE '\\')
                          AND (CAST(:requestedStatus AS varchar) IS NULL OR
                               (CAST(:requestedStatus AS varchar) = 'ACTIVE' AND status = 'ACTIVE' AND temporary_password_expires_at IS NULL) OR
                               (CAST(:requestedStatus AS varchar) = 'PENDING_FIRST_LOGIN' AND status = 'ACTIVE' AND temporary_password_expires_at IS NOT NULL) OR
                               (CAST(:requestedStatus AS varchar) = status AND status IN ('DISABLED', 'DELETION_PENDING')))
                        """)
                .param("query", query)
                .param("requestedStatus", status == null ? null : status.name())
                .query(Long.class).single();
    }

    void createTenant(UUID tenantId, Instant now) {
        jdbc.sql("INSERT INTO tenant(id, status, created_at, updated_at) VALUES (:id, 'ACTIVE', :now, :now)")
                .param("id", tenantId).param("now", Timestamp.from(now)).update();
    }

    void createUser(UUID userId, UUID tenantId, String username, String passwordDigest, Instant expiresAt, Instant now) {
        jdbc.sql("""
                        INSERT INTO app_user(id, username, password_digest, temporary_password_expires_at,
                                             role, status, tenant_id, credential_version, created_at, updated_at)
                        VALUES (:id, :username, :digest, :expiresAt, 'USER', 'ACTIVE', :tenantId, 1, :now, :now)
                        """)
                .param("id", userId).param("tenantId", tenantId).param("username", username)
                .param("digest", passwordDigest).param("expiresAt", Timestamp.from(expiresAt))
                .param("now", Timestamp.from(now)).update();
    }

    void copyDefaultDictionaries(UUID tenantId, Instant now) {
        jdbc.sql("SELECT pg_advisory_xact_lock_shared(:lockId)")
                .param("lockId", DEFAULT_DICTIONARY_LOCK).query((rs, row) -> true).single();
        copySimple("unit", "UNIT", tenantId, now);
        copySimple("funding_channel", "FUNDING_CHANNEL", tenantId, now);
        copySimple("purchase_channel", "PURCHASE_CHANNEL", tenantId, now);
        copySimple("income_category", "INCOME_CATEGORY", tenantId, now);
        copyExpenseCategories(tenantId, now, true);
        copyExpenseCategories(tenantId, now, false);
    }

    private void copySimple(String table, String type, UUID tenantId, Instant now) {
        String sql = "INSERT INTO " + table + "(tenant_id, id, display_name, normalized_name, sort_order, status, created_at, updated_at) "
                + "SELECT :tenantId, id, display_name, normalized_name, sort_order, status, :now, :now "
                + "FROM default_dictionary_item WHERE dictionary_type = :type AND status = 'ACTIVE' ORDER BY sort_order, id";
        jdbc.sql(sql).param("tenantId", tenantId).param("type", type).param("now", Timestamp.from(now)).update();
    }

    private void copyExpenseCategories(UUID tenantId, Instant now, boolean roots) {
        jdbc.sql("""
                        INSERT INTO expense_category(tenant_id, id, parent_id, display_name, normalized_name,
                                                     sort_order, status, created_at, updated_at)
                        SELECT :tenantId, id, parent_id, display_name, normalized_name,
                               sort_order, status, :now, :now
                        FROM default_dictionary_item
                        WHERE dictionary_type = 'EXPENSE_CATEGORY'
                          AND status = 'ACTIVE'
                          AND (parent_id IS NULL OR parent_id IN (
                              SELECT id FROM default_dictionary_item
                              WHERE dictionary_type = 'EXPENSE_CATEGORY' AND status = 'ACTIVE'
                          ))
                          AND ((:roots AND parent_id IS NULL) OR (NOT :roots AND parent_id IS NOT NULL))
                        ORDER BY sort_order, id
                        """)
                .param("tenantId", tenantId).param("roots", roots).param("now", Timestamp.from(now)).update();
    }

    Optional<AdminUserRow> findUserForUpdate(UUID userId) {
        return jdbc.sql("""
                        SELECT id, username, status, temporary_password_expires_at,
                               credential_version, last_active_at, created_at, tenant_id
                        FROM app_user WHERE id = :id AND role = 'USER' AND status <> 'DELETED'
                        FOR UPDATE
                        """)
                .param("id", userId).query(AdminUserRepository::mapRow).optional();
    }

    AdminUserRow findUser(UUID userId) {
        return jdbc.sql("""
                        SELECT id, username, status, temporary_password_expires_at,
                               credential_version, last_active_at, created_at, tenant_id
                        FROM app_user WHERE id = :id AND role = 'USER' AND status <> 'DELETED'
                        """)
                .param("id", userId).query(AdminUserRepository::mapRow).single();
    }

    int updateStatus(UUID userId, long version, String status, Instant now) {
        return jdbc.sql("""
                        UPDATE app_user SET status = :status, credential_version = credential_version + 1, updated_at = :now
                        WHERE id = :id AND credential_version = :version
                        """)
                .param("status", status).param("now", Timestamp.from(now))
                .param("id", userId).param("version", version).update();
    }

    int updateTenantStatus(UUID tenantId, String status, Instant now) {
        return jdbc.sql("UPDATE tenant SET status = :status, updated_at = :now WHERE id = :id")
                .param("status", status).param("now", Timestamp.from(now)).param("id", tenantId).update();
    }

    int resetTemporaryPassword(UUID userId, long version, String digest, Instant expiresAt, Instant now) {
        return jdbc.sql("""
                        UPDATE app_user SET password_digest = :digest, temporary_password_expires_at = :expiresAt,
                                            credential_version = credential_version + 1, updated_at = :now
                        WHERE id = :id AND credential_version = :version
                        """)
                .param("digest", digest).param("expiresAt", Timestamp.from(expiresAt)).param("now", Timestamp.from(now))
                .param("id", userId).param("version", version).update();
    }

    private static AdminUserRow mapRow(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
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
