package com.mybill.persistence.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** JPA 对模板、偏好、幂等、任务及审计表的结构映射。 */
final class SupportEntities {
    private SupportEntities() { }
}

@Entity @Table(name = "daily_entry_template")
class DailyEntryTemplateEntity extends TenantScopedEntity {
    @Column(name = "entry_type", nullable = false) String entryType;
    @Column(name = "display_name", nullable = false) String displayName;
    @Column(name = "normalized_name", nullable = false) String normalizedName;
    @Column(name = "source_record_id") UUID sourceRecordId;
    @Column(name = "product_id") UUID productId;
    @Column(name = "product_name_snapshot") String productNameSnapshot;
    @Column(name = "primary_category_id") UUID primaryCategoryId;
    @Column(name = "primary_category_name_snapshot") String primaryCategoryNameSnapshot;
    @Column(name = "secondary_category_id") UUID secondaryCategoryId;
    @Column(name = "secondary_category_name_snapshot") String secondaryCategoryNameSnapshot;
    @Column(name = "unit_id") UUID unitId;
    @Column(name = "unit_name_snapshot") String unitNameSnapshot;
    @Column(name = "unit_price") BigDecimal unitPrice;
    @Column BigDecimal quantity;
    @Column(name = "paid_amount") BigDecimal paidAmount;
    @Column(name = "purchase_channel_id") UUID purchaseChannelId;
    @Column(name = "purchase_channel_name_snapshot") String purchaseChannelNameSnapshot;
    @Column(name = "location_label_id") UUID locationLabelId;
    @Column(name = "location_label_name_snapshot") String locationLabelNameSnapshot;
    @Column(name = "payer_id") UUID payerId;
    @Column(name = "payer_name_snapshot") String payerNameSnapshot;
    @Column(name = "income_category_id") UUID incomeCategoryId;
    @Column(name = "income_category_name_snapshot") String incomeCategoryNameSnapshot;
    @Column(name = "income_amount") BigDecimal incomeAmount;
    @Column(name = "funding_channel_id", nullable = false) UUID fundingChannelId;
    @Column(name = "funding_channel_name_snapshot", nullable = false) String fundingChannelNameSnapshot;
    @Column(name = "last_used_at", nullable = false) Instant lastUsedAt;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected DailyEntryTemplateEntity() { }
}

@Entity @Table(name = "user_preference")
class UserPreferenceEntity {
    @jakarta.persistence.EmbeddedId UserPreferenceId id;
    @Column(name = "default_funding_channel_id") UUID defaultFundingChannelId;
    @Column(name = "ledger_default_range", nullable = false) String ledgerDefaultRange;
    @Column(name = "report_default_range", nullable = false) String reportDefaultRange;
    @Column(name = "theme_mode", nullable = false) String themeMode;
    @Column(name = "recent_entry_type", nullable = false) String recentEntryType;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected UserPreferenceEntity() { }
}

@jakarta.persistence.Embeddable
class UserPreferenceId implements java.io.Serializable {
    @Column(name = "tenant_id") UUID tenantId;
    @Column(name = "user_id") UUID userId;
    protected UserPreferenceId() { }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof UserPreferenceId that)) return false;
        return java.util.Objects.equals(tenantId, that.tenantId) && java.util.Objects.equals(userId, that.userId);
    }

    @Override
    public int hashCode() {
        return java.util.Objects.hash(tenantId, userId);
    }
}

@Entity @Table(name = "idempotency_record")
class IdempotencyRecordEntity extends TenantScopedEntity {
    @Column(nullable = false) String operation;
    @Column(name = "idempotency_key", nullable = false) String idempotencyKey;
    @Column(name = "request_digest", nullable = false) String requestDigest;
    @Column(name = "result_reference") String resultReference;
    @Column(nullable = false) String status;
    @Column(name = "expires_at", nullable = false) Instant expiresAt;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected IdempotencyRecordEntity() { }
}

@Entity @Table(name = "export_job")
class ExportJobEntity extends TenantScopedEntity {
    @Column(name = "user_id", nullable = false) UUID userId;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "filter_snapshot", nullable = false, columnDefinition = "jsonb") Map<String, Object> filterSnapshot;
    @Column(nullable = false) String status;
    @Column(name = "file_location") String fileLocation;
    @Column(name = "expires_at") Instant expiresAt;
    @Column(name = "error_summary") String errorSummary;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected ExportJobEntity() { }
}

@Entity @Table(name = "account_deletion_job")
class AccountDeletionJobEntity extends TenantScopedEntity {
    @Column(name = "user_id", nullable = false) UUID userId;
    @Column(nullable = false) String status;
    @Column(name = "requested_at", nullable = false) Instant requestedAt;
    @Column(name = "executed_at") Instant executedAt;
    @Column(name = "result_summary") String resultSummary;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected AccountDeletionJobEntity() { }
}

@Entity @Table(name = "admin_audit_log")
class AdminAuditLogEntity {
    @Id UUID id;
    @Column(name = "administrator_user_id", nullable = false) UUID administratorUserId;
    @Column(nullable = false) String action;
    @Column(name = "object_type", nullable = false) String objectType;
    @Column(name = "object_id", nullable = false) String objectId;
    @Column(nullable = false) String result;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "safe_summary", nullable = false, columnDefinition = "jsonb") Map<String, Object> safeSummary;
    @Column(name = "occurred_at", nullable = false) Instant occurredAt;
    protected AdminAuditLogEntity() { }
}

@Entity @Table(name = "job_run")
class JobRunEntity {
    @Id UUID id;
    @Column(name = "tenant_id") UUID tenantId;
    @Column(name = "job_type", nullable = false) String jobType;
    @Column(name = "batch_key") String batchKey;
    @Column(nullable = false) String status;
    @Column(name = "started_at") Instant startedAt;
    @Column(name = "finished_at") Instant finishedAt;
    @Column(name = "processed_count", nullable = false) long processedCount;
    @Column(name = "error_summary") String errorSummary;
    @Column(name = "attempt_count", nullable = false) int attemptCount;
    @Column(name = "max_attempts", nullable = false) int maxAttempts;
    @Column(name = "lease_owner") String leaseOwner;
    @Column(name = "lease_expires_at") Instant leaseExpiresAt;
    @Column(name = "cancel_requested", nullable = false) boolean cancelRequested;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected JobRunEntity() { }
}

@Entity @Table(name = "backup_run")
class BackupRunEntity {
    @Id UUID id;
    @Column(name = "batch_key", nullable = false) String batchKey;
    @Column(nullable = false) String status;
    @Column(name = "started_at", nullable = false) Instant startedAt;
    @Column(name = "finished_at") Instant finishedAt;
    @Column(name = "artifact_checksum") String artifactChecksum;
    @Column(name = "processed_bytes") Long processedBytes;
    @Column(name = "error_summary") String errorSummary;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    protected BackupRunEntity() { }
}
