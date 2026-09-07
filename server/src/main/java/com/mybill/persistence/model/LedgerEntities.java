package com.mybill.persistence.model;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** MyBatis-Plus 对收支与调整核心字段的结构映射；金额始终使用 BigDecimal。 */
final class LedgerEntities {
    private LedgerEntities() { }
}

@TableName("ledger_entry")
class LedgerEntryEntity extends TenantScopedEntity {
    @TableField("entry_type") String entryType;
    @TableField("business_time") Instant businessTime;
    @TableField("business_date") LocalDate businessDate;
    @Version @TableField long version;
    @TableField("lifecycle_status") String lifecycleStatus;
    @TableField("deleted_at") Instant deletedAt;
    @TableField("purge_after") Instant purgeAfter;
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
    @TableField("calculated_amount") BigDecimal calculatedAmount;
    @TableField("paid_amount") BigDecimal paidAmount;
    @TableField("purchase_channel_id") UUID purchaseChannelId;
    @TableField("purchase_channel_name_snapshot") String purchaseChannelNameSnapshot;
    @TableField("location_label_id") UUID locationLabelId;
    @TableField("location_label_name_snapshot") String locationLabelNameSnapshot;
    @TableField("income_name") String incomeName;
    @TableField("payer_id") UUID payerId;
    @TableField("payer_name_snapshot") String payerNameSnapshot;
    @TableField("income_category_id") UUID incomeCategoryId;
    @TableField("income_category_name_snapshot") String incomeCategoryNameSnapshot;
    @TableField("income_amount") BigDecimal incomeAmount;
    @TableField("funding_channel_id") UUID fundingChannelId;
    @TableField("funding_channel_name_snapshot") String fundingChannelNameSnapshot;
    @TableField String note;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected LedgerEntryEntity() { }
}

@TableName("expense_adjustment")
class ExpenseAdjustmentEntity extends TenantScopedEntity {
    @TableField("original_expense_id") UUID originalExpenseId;
    @TableField("adjustment_type") String adjustmentType;
    @TableField BigDecimal amount;
    @TableField("business_time") Instant businessTime;
    @TableField("business_date") LocalDate businessDate;
    @TableField String status;
    @TableField("deleted_at") Instant deletedAt;
    @TableField("purge_after") Instant purgeAfter;
    @Version @TableField long version;
    @TableField String note;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected ExpenseAdjustmentEntity() { }
}
