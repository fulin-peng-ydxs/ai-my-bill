package com.mybill.account;

import com.mybill.shared.persistence.DatabaseRow;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
class AccountDeletionRepository {
    private final MybatisOperations operations;
    private final AccountDeletionRepositoryMapper mapper;

    AccountDeletionRepository(MybatisOperations operations, AccountDeletionRepositoryMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    Optional<UserRow> lockUser(UUID userId) {
        return operations.select(mapper::lockUser).param("userId", userId)
                .map(AccountDeletionRepository::mapUser).optional();
    }

    List<String> exportLocations(UUID userId) {
        return operations.select(mapper::exportLocations).param("userId", userId).map(String.class).list();
    }

    boolean exportLocationExists(String location) {
        return operations.select(mapper::exportLocationExists).param("location", location)
                .map(Boolean.class).single();
    }

    void insertDeletionJob(UUID id, UUID userId, Instant now) {
        operations.update(mapper::insertDeletionJob).param("id", id).param("userId", userId)
                .param("now", Timestamp.from(now)).execute();
    }

    void insertAudit(UUID id, String actorType, String subjectDigest, Instant now, Instant expiresAt) {
        operations.update(mapper::insertAudit).param("id", id).param("actorType", actorType)
                .param("subjectDigest", subjectDigest).param("now", Timestamp.from(now))
                .param("expiresAt", Timestamp.from(expiresAt)).execute();
    }

    void eraseTenant(UUID tenantId, UUID userId, UUID deletionReference) {
        delete(mapper::deleteAdjustments, tenantId, userId);
        delete(mapper::deleteTemplates, tenantId, userId);
        delete(mapper::deleteLedger, tenantId, userId);
        delete(mapper::deleteProductMergeEvents, tenantId, userId);
        delete(mapper::deleteProducts, tenantId, userId);
        delete(mapper::deletePreferences, tenantId, userId);
        delete(mapper::deleteIdempotency, tenantId, userId);
        delete(mapper::deleteExports, tenantId, userId);
        delete(mapper::deleteExpenseCategories, tenantId, userId);
        delete(mapper::deleteUnits, tenantId, userId);
        delete(mapper::deleteFundingChannels, tenantId, userId);
        delete(mapper::deletePurchaseChannels, tenantId, userId);
        delete(mapper::deleteLocationLabels, tenantId, userId);
        delete(mapper::deleteIncomeCategories, tenantId, userId);
        delete(mapper::deletePayers, tenantId, userId);
        delete(mapper::deleteDeletionJobs, tenantId, userId);
        delete(mapper::deleteJobRuns, tenantId, userId);
        delete(mapper::deleteSessions, tenantId, userId);
        operations.update(mapper::anonymizePriorAdminAudits).param("userId", userId)
                .param("reference", deletionReference.toString()).execute();
        requireOne(operations.update(mapper::deleteUser).param("userId", userId).execute());
        requireOne(operations.update(mapper::deleteTenant).param("tenantId", tenantId).execute());
    }

    private void delete(java.util.function.ToIntFunction<java.util.Map<String, Object>> statement,
                        UUID tenantId, UUID userId) {
        operations.update(statement).param("tenantId", tenantId).param("userId", userId).execute();
    }

    int purgeExpiredAudits(Instant now, int limit) {
        return operations.update(mapper::purgeExpiredAudits).param("now", Timestamp.from(now))
                .param("limit", limit).execute();
    }

    private static UserRow mapUser(DatabaseRow row, int number) throws SQLException {
        return new UserRow(row.getObject("id", UUID.class), row.getObject("tenant_id", UUID.class),
                row.getString("username"), row.getString("status"), row.getLong("credential_version"));
    }

    private static void requireOne(int count) {
        if (count != 1) throw new IllegalStateException("账号注销未命中唯一身份记录");
    }

    record UserRow(UUID id, UUID tenantId, String username, String status, long version) { }
}
