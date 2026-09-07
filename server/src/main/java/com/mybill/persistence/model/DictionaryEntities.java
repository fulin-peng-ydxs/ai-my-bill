package com.mybill.persistence.model;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** MyBatis-Plus 对默认字典、七类个人字典及商品的结构映射。 */
final class DictionaryEntities {
    private DictionaryEntities() { }
}

@TableName("default_dictionary_item")
class DefaultDictionaryItemEntity {
    @TableId UUID id;
    @TableField("dictionary_type") String dictionaryType;
    @TableField("stable_key") String stableKey;
    @TableField("parent_id") UUID parentId;
    @TableField("display_name") String displayName;
    @TableField("normalized_name") String normalizedName;
    @TableField("sort_order") int sortOrder;
    @TableField String status;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected DefaultDictionaryItemEntity() { }
}

@TableName("expense_category")
class ExpenseCategoryEntity extends TenantScopedEntity {
    @TableField("parent_id") UUID parentId;
    @TableField("display_name") String displayName;
    @TableField("normalized_name") String normalizedName;
    @TableField("sort_order") int sortOrder;
    @TableField String status;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected ExpenseCategoryEntity() { }
}

@TableName("unit")
class UnitEntity extends NamedTenantEntity { protected UnitEntity() { } }

@TableName("funding_channel")
class FundingChannelEntity extends NamedTenantEntity { protected FundingChannelEntity() { } }

@TableName("purchase_channel")
class PurchaseChannelEntity extends NamedTenantEntity { protected PurchaseChannelEntity() { } }

@TableName("location_label")
class LocationLabelEntity extends NamedTenantEntity { protected LocationLabelEntity() { } }

@TableName("income_category")
class IncomeCategoryEntity extends NamedTenantEntity { protected IncomeCategoryEntity() { } }

@TableName("payer")
class PayerEntity extends NamedTenantEntity { protected PayerEntity() { } }

abstract class NamedTenantEntity extends TenantScopedEntity {
    @TableField("display_name") String displayName;
    @TableField("normalized_name") String normalizedName;
    @TableField("sort_order") int sortOrder;
    @TableField String status;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected NamedTenantEntity() { }
}

@TableName("product")
class ProductEntity extends TenantScopedEntity {
    @TableField("display_name") String displayName;
    @TableField("normalized_name") String normalizedName;
    @TableField("default_primary_category_id") UUID defaultPrimaryCategoryId;
    @TableField("default_secondary_category_id") UUID defaultSecondaryCategoryId;
    @TableField("default_unit_id") UUID defaultUnitId;
    @TableField("last_unit_price") BigDecimal lastUnitPrice;
    @TableField("last_quantity") BigDecimal lastQuantity;
    @TableField("last_funding_channel_id") UUID lastFundingChannelId;
    @TableField("last_purchase_channel_id") UUID lastPurchaseChannelId;
    @TableField String status;
    @TableField("merged_into_id") UUID mergedIntoId;
    @TableField("created_at") Instant createdAt;
    @TableField("updated_at") Instant updatedAt;
    protected ProductEntity() { }
}

@TableName("product_merge_event")
class ProductMergeEventEntity extends TenantScopedEntity {
    @TableField("source_product_id") UUID sourceProductId;
    @TableField("target_product_id") UUID targetProductId;
    @TableField("initiated_by_user_id") UUID initiatedByUserId;
    @TableField("affected_ledger_entries") long affectedLedgerEntries;
    @TableField("affected_templates") int affectedTemplates;
    @TableField("template_conflict") boolean templateConflict;
    @TableField("occurred_at") Instant occurredAt;
    protected ProductMergeEventEntity() { }
}
