package com.mybill.persistence.model;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** MyBatis-Plus 对模板、偏好、幂等、任务及审计表的结构映射。 */
final class SupportEntities {
    private SupportEntities() { }
}

@TableName("daily_entry_template")
class DailyEntryTemplateEntity extends TenantScopedEntity {
    @TableField("entry_type") String entryType;
    @TableField("display_name") String displayName;
    @TableField("normalized_name") String normalizedName;
    @TableField("source_record_id") UUID sourceRecordId;
    @TableField("product_id") UUID productId;
    @TableField("product_name_snapshot") String productNameSnapshot;
    @TableField("primary_category_id") UUID primaryCategoryId;
    @TableField("primary_category_name_snapshot") String primaryCategoryNameSnapshot;
    @TableField("secondary_category_id") UUID secondaryCategoryId;
    @TableField("secondary_category_name_snapshot") String secondaryCategoryNameSnapshot;
    @TableField("unit_id") UUID unitId;
    @TableField("unit_name_snapshot") String unitNameSnapshot;
    @TableField("unit_price") BigDecimal unitPrice;
    @TableField BigDecimal quantity;
    @TableField("paid_amount") BigDecimal paidAmount;
    @TableField("purchase_channel_id") UUID purchaseChannelId;
    @TableField("purchase_channel_name_snapshot") String purchaseChannelNameSnapshot;
    @TableField("location_label_id") UUID locationLabelId;
    @TableField("location_label_name_snapshot") String locationLabelNameSnapshot;
    @TableField("payer_id") UUID payerId;
    @TableField("payer_name_snapshot") String payerNameSnapshot;
    @TableField("income_category_id") UUID incomeCategoryId;
    @TableField("income_category_name_snapshot") String incomeCategoryNameSnapshot;
    @TableField("income_amount") BigDecimal incomeAmount;
    @TableField("funding_channel_id") UUID fundingChannelId;
    @TableField("funding_channel_name_snapshot") String fundingChannelNameSnapshot;
    @TableField("last_used_at") Instant lastUsedAt;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected DailyEntryTemplateEntity() { }
}

@TableName("user_preference")
class UserPreferenceEntity {
    @TableField("tenant_id") UUID tenantId;
    @TableId("user_id") UUID userId;
    @TableField("default_funding_channel_id") UUID defaultFundingChannelId;
    @TableField("ledger_default_range") String ledgerDefaultRange;
    @TableField("report_default_range") String reportDefaultRange;
    @TableField("theme_mode") String themeMode;
    @TableField("recent_entry_type") String recentEntryType;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected UserPreferenceEntity() { }
}

@TableName("idempotency_record")
class IdempotencyRecordEntity extends TenantScopedEntity {
    @TableField String operation;
    @TableField("idempotency_key") String idempotencyKey;
    @TableField("request_digest") String requestDigest;
    @TableField("result_reference") String resultReference;
    @TableField String status;
    @TableField("expires_at") Instant expiresAt;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected IdempotencyRecordEntity() { }
}

@TableName(value = "export_job", autoResultMap = true)
class ExportJobEntity extends TenantScopedEntity {
    @TableField("user_id") UUID userId;
    @TableField(value = "filter_snapshot", typeHandler = JacksonTypeHandler.class) Map<String, Object> filterSnapshot;
    @TableField String status;
    @TableField("file_location") String fileLocation;
    @TableField("expires_at") Instant expiresAt;
    @TableField("error_summary") String errorSummary;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected ExportJobEntity() { }
}

@TableName("account_deletion_job")
class AccountDeletionJobEntity extends TenantScopedEntity {
    @TableField("user_id") UUID userId;
    @TableField String status;
    @TableField("requested_at") Instant requestedAt;
    @TableField("executed_at") Instant executedAt;
    @TableField("result_summary") String resultSummary;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected AccountDeletionJobEntity() { }
}

@TableName(value = "admin_audit_log", autoResultMap = true)
class AdminAuditLogEntity {
    @TableId UUID id;
    @TableField("administrator_user_id") UUID administratorUserId;
    @TableField String action;
    @TableField("object_type") String objectType;
    @TableField("object_id") String objectId;
    @TableField String result;
    @TableField(value = "safe_summary", typeHandler = JacksonTypeHandler.class) Map<String, Object> safeSummary;
    @TableField("occurred_at") Instant occurredAt;
    protected AdminAuditLogEntity() { }
}

@TableName("job_run")
class JobRunEntity {
    @TableId UUID id;
    @TableField("tenant_id") UUID tenantId;
    @TableField("job_type") String jobType;
    @TableField("batch_key") String batchKey;
    @TableField String status;
    @TableField("started_at") Instant startedAt;
    @TableField("finished_at") Instant finishedAt;
    @TableField("processed_count") long processedCount;
    @TableField("error_summary") String errorSummary;
    @TableField("attempt_count") int attemptCount;
    @TableField("max_attempts") int maxAttempts;
    @TableField("lease_owner") String leaseOwner;
    @TableField("lease_expires_at") Instant leaseExpiresAt;
    @TableField("cancel_requested") boolean cancelRequested;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected JobRunEntity() { }
}

@TableName("backup_run")
class BackupRunEntity {
    @TableId UUID id;
    @TableField("batch_key") String batchKey;
    @TableField String status;
    @TableField("started_at") Instant startedAt;
    @TableField("finished_at") Instant finishedAt;
    @TableField("artifact_checksum") String artifactChecksum;
    @TableField("processed_bytes") Long processedBytes;
    @TableField("error_summary") String errorSummary;
    @TableField("created_at") Instant createdAt;
    protected BackupRunEntity() { }
}
