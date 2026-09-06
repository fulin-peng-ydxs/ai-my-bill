package com.mybill.persistence.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** JPA 对默认字典、七类个人字典及商品的结构映射；维护行为由后续业务阶段实现。 */
final class DictionaryEntities {
    private DictionaryEntities() { }
}

@Entity @Table(name = "default_dictionary_item")
class DefaultDictionaryItemEntity {
    @Id UUID id;
    @Column(name = "dictionary_type", nullable = false) String dictionaryType;
    @Column(name = "stable_key", nullable = false) String stableKey;
    @Column(name = "parent_id") UUID parentId;
    @Column(name = "display_name", nullable = false) String displayName;
    @Column(name = "normalized_name", nullable = false) String normalizedName;
    @Column(name = "sort_order", nullable = false) int sortOrder;
    @Column(nullable = false) String status;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected DefaultDictionaryItemEntity() { }
}

@Entity @Table(name = "expense_category")
class ExpenseCategoryEntity extends TenantScopedEntity {
    @Column(name = "parent_id") UUID parentId;
    @Column(name = "display_name", nullable = false) String displayName;
    @Column(name = "normalized_name", nullable = false) String normalizedName;
    @Column(name = "sort_order", nullable = false) int sortOrder;
    @Column(nullable = false) String status;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected ExpenseCategoryEntity() { }
}

@Entity @Table(name = "unit")
class UnitEntity extends NamedTenantEntity { protected UnitEntity() { } }

@Entity @Table(name = "funding_channel")
class FundingChannelEntity extends NamedTenantEntity { protected FundingChannelEntity() { } }

@Entity @Table(name = "purchase_channel")
class PurchaseChannelEntity extends NamedTenantEntity { protected PurchaseChannelEntity() { } }

@Entity @Table(name = "location_label")
class LocationLabelEntity extends NamedTenantEntity { protected LocationLabelEntity() { } }

@Entity @Table(name = "income_category")
class IncomeCategoryEntity extends NamedTenantEntity { protected IncomeCategoryEntity() { } }

@Entity @Table(name = "payer")
class PayerEntity extends NamedTenantEntity { protected PayerEntity() { } }

@jakarta.persistence.MappedSuperclass
abstract class NamedTenantEntity extends TenantScopedEntity {
    @Column(name = "display_name", nullable = false) String displayName;
    @Column(name = "normalized_name", nullable = false) String normalizedName;
    @Column(name = "sort_order", nullable = false) int sortOrder;
    @Column(nullable = false) String status;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected NamedTenantEntity() { }
}

@Entity @Table(name = "product")
class ProductEntity extends TenantScopedEntity {
    @Column(name = "display_name", nullable = false) String displayName;
    @Column(name = "normalized_name", nullable = false) String normalizedName;
    @Column(name = "default_primary_category_id") UUID defaultPrimaryCategoryId;
    @Column(name = "default_secondary_category_id") UUID defaultSecondaryCategoryId;
    @Column(name = "default_unit_id") UUID defaultUnitId;
    @Column(name = "last_unit_price") BigDecimal lastUnitPrice;
    @Column(name = "last_quantity") BigDecimal lastQuantity;
    @Column(name = "last_funding_channel_id") UUID lastFundingChannelId;
    @Column(name = "last_purchase_channel_id") UUID lastPurchaseChannelId;
    @Column(nullable = false) String status;
    @Column(name = "merged_into_id") UUID mergedIntoId;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    protected ProductEntity() { }
}

@Entity @Table(name = "product_merge_event")
class ProductMergeEventEntity extends TenantScopedEntity {
    @Column(name = "source_product_id", nullable = false) UUID sourceProductId;
    @Column(name = "target_product_id", nullable = false) UUID targetProductId;
    @Column(name = "initiated_by_user_id", nullable = false) UUID initiatedByUserId;
    @Column(name = "affected_ledger_entries", nullable = false) long affectedLedgerEntries;
    @Column(name = "affected_templates", nullable = false) int affectedTemplates;
    @Column(name = "template_conflict", nullable = false) boolean templateConflict;
    @Column(name = "occurred_at", nullable = false) Instant occurredAt;
    protected ProductMergeEventEntity() { }
}
