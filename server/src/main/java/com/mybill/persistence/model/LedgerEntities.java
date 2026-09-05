package com.mybill.persistence.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** JPA 对收支与调整核心字段的结构映射；金额始终使用 BigDecimal。 */
final class LedgerEntities {
    private LedgerEntities() { }
}

@Entity @Table(name = "ledger_entry")
class LedgerEntryEntity extends TenantScopedEntity {
    @Column(name = "entry_type", nullable = false) String entryType;
    @Column(name = "business_time", nullable = false) Instant businessTime;
    @Column(name = "business_date", nullable = false) LocalDate businessDate;
    @Version @Column(nullable = false) long version;
    @Column(name = "lifecycle_status", nullable = false) String lifecycleStatus;
    @Column(name = "deleted_at") Instant deletedAt;
    @Column(name = "purge_after") Instant purgeAfter;
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
    @Column(name = "calculated_amount") BigDecimal calculatedAmount;
    @Column(name = "paid_amount") BigDecimal paidAmount;
    @Column(name = "purchase_channel_id") UUID purchaseChannelId;
    @Column(name = "purchase_channel_name_snapshot") String purchaseChannelNameSnapshot;
    @Column(name = "location_label_id") UUID locationLabelId;
    @Column(name = "location_label_name_snapshot") String locationLabelNameSnapshot;
    @Column(name = "income_name") String incomeName;
    @Column(name = "payer_id") UUID payerId;
    @Column(name = "payer_name_snapshot") String payerNameSnapshot;
    @Column(name = "income_category_id") UUID incomeCategoryId;
    @Column(name = "income_category_name_snapshot") String incomeCategoryNameSnapshot;
    @Column(name = "income_amount") BigDecimal incomeAmount;
    @Column(name = "funding_channel_id", nullable = false) UUID fundingChannelId;
    @Column(name = "funding_channel_name_snapshot", nullable = false) String fundingChannelNameSnapshot;
    @Column(length = 500) String note;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected LedgerEntryEntity() { }
}

@Entity @Table(name = "expense_adjustment")
class ExpenseAdjustmentEntity extends TenantScopedEntity {
    @Column(name = "original_expense_id", nullable = false) UUID originalExpenseId;
    @Column(name = "adjustment_type", nullable = false) String adjustmentType;
    @Column(nullable = false) BigDecimal amount;
    @Column(name = "business_time", nullable = false) Instant businessTime;
    @Column(name = "business_date", nullable = false) LocalDate businessDate;
    @Column(nullable = false) String status;
    @Column(name = "deleted_at") Instant deletedAt;
    @Column(name = "purge_after") Instant purgeAfter;
    @Version @Column(nullable = false) long version;
    @Column(length = 500) String note;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected ExpenseAdjustmentEntity() { }
}
