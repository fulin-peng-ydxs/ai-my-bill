package com.mybill.ledger;

import com.mybill.ledger.DailyTemplateContracts.EntryType;
import com.mybill.ledger.DailyTemplateContracts.TemplateSummary;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 日常模板仓储；所有方法必须在已设置 RLS 租户上下文的事务内调用。 */
@Repository
class DailyTemplateRepository {
    private final MybatisOperations operations;
    private final DailyTemplateRepositoryMapper mapper;
    DailyTemplateRepository(MybatisOperations operations, DailyTemplateRepositoryMapper mapper) { this.operations = operations; this.mapper = mapper; }

    Optional<SourceRow> lockActiveSource(UUID id) {
        return operations.select(mapper::lockActiveSource).param("id", id).map(DailyTemplateRepository::mapSource).optional();
    }

    TemplateSummary upsert(SourceRow source, String displayName, String normalizedName, Instant now) {
        UUID id = UUID.randomUUID();
        return operations.select(mapper::upsert)
                .param("id", id).param("type", source.entryType().name()).param("display", displayName)
                .param("normalized", normalizedName).param("source", source.id())
                .param("productId", source.productId()).param("productName", source.currentProductName())
                .param("primaryId", source.primaryCategoryId()).param("primaryName", source.primaryCategoryName())
                .param("secondaryId", source.secondaryCategoryId()).param("secondaryName", source.secondaryCategoryName())
                .param("unitId", source.unitId()).param("unitName", source.unitName())
                .param("unitPrice", source.unitPrice()).param("quantity", source.quantity()).param("paidAmount", source.paidAmount())
                .param("purchaseId", source.purchaseChannelId()).param("purchaseName", source.purchaseChannelName())
                .param("locationId", source.locationLabelId()).param("locationName", source.locationLabelName())
                .param("payerId", source.payerId()).param("payerName", source.payerName())
                .param("incomeCategoryId", source.incomeCategoryId()).param("incomeCategoryName", source.incomeCategoryName())
                .param("incomeAmount", source.incomeAmount()).param("fundingId", source.fundingChannelId())
                .param("fundingName", source.fundingChannelName()).param("now", Timestamp.from(now))
                .map(DailyTemplateRepository::mapSummary).single();
    }

    List<TemplateSummary> list(EntryType type) {
        return operations.select(mapper::list).param("type", type.name()).map(DailyTemplateRepository::mapSummary).list();
    }

    Optional<TemplateRow> lockTemplate(UUID id) {
        return operations.select(mapper::lockTemplate).param("id", id).map(DailyTemplateRepository::mapTemplate).optional();
    }

    void touch(UUID id, Instant now) {
        if (operations.update(mapper::touch)
                .param("now", Timestamp.from(now)).param("id", id).execute() != 1) {
            throw new IllegalStateException("日常模板最近使用时间更新未命中唯一记录");
        }
    }

    boolean delete(UUID id) {
        return operations.update(mapper::delete).param("id", id).execute() == 1;
    }

    private static TemplateSummary mapSummary(DatabaseRow rs, int row) throws SQLException {
        return new TemplateSummary(rs.getObject("id", UUID.class), EntryType.valueOf(rs.getString("entry_type")),
                rs.getString("display_name"), money(rs.getBigDecimal("amount")), rs.getString("context_name"),
                rs.getTimestamp("last_used_at").toInstant());
    }

    private static SourceRow mapSource(DatabaseRow rs, int row) throws SQLException {
        return new SourceRow(rs.getObject("id", UUID.class), EntryType.valueOf(rs.getString("entry_type")),
                rs.getObject("product_id", UUID.class), rs.getString("current_product_name"),
                rs.getString("current_product_normalized"), bool(rs,"product_active"),
                rs.getObject("primary_category_id", UUID.class), rs.getString("primary_category_name_snapshot"), bool(rs,"primary_active"),
                rs.getObject("secondary_category_id", UUID.class), rs.getString("secondary_category_name_snapshot"), bool(rs,"secondary_active"),
                rs.getObject("unit_id", UUID.class), rs.getString("unit_name_snapshot"), bool(rs,"unit_active"),
                rs.getBigDecimal("unit_price"), rs.getBigDecimal("quantity"), rs.getBigDecimal("paid_amount"),
                rs.getObject("funding_channel_id", UUID.class), rs.getString("funding_channel_name_snapshot"), bool(rs,"funding_active"),
                rs.getObject("purchase_channel_id", UUID.class), rs.getString("purchase_channel_name_snapshot"), bool(rs,"purchase_active"),
                rs.getObject("location_label_id", UUID.class), rs.getString("location_label_name_snapshot"), bool(rs,"location_active"),
                rs.getString("income_name"), rs.getObject("payer_id", UUID.class), rs.getString("payer_name_snapshot"), bool(rs,"payer_active"),
                rs.getObject("income_category_id", UUID.class), rs.getString("income_category_name_snapshot"), bool(rs,"income_category_active"),
                rs.getBigDecimal("income_amount"));
    }

    private static TemplateRow mapTemplate(DatabaseRow rs, int row) throws SQLException {
        return new TemplateRow(rs.getObject("id", UUID.class), EntryType.valueOf(rs.getString("entry_type")),
                rs.getString("display_name"), rs.getObject("product_id", UUID.class), rs.getString("product_name_snapshot"), bool(rs,"product_active"),
                rs.getObject("primary_category_id", UUID.class), rs.getString("primary_category_name_snapshot"), bool(rs,"primary_active"),
                rs.getObject("secondary_category_id", UUID.class), rs.getString("secondary_category_name_snapshot"), bool(rs,"secondary_active"),
                rs.getObject("unit_id", UUID.class), rs.getString("unit_name_snapshot"), bool(rs,"unit_active"),
                rs.getBigDecimal("unit_price"), rs.getBigDecimal("quantity"), rs.getBigDecimal("paid_amount"),
                rs.getObject("funding_channel_id", UUID.class), rs.getString("funding_channel_name_snapshot"), bool(rs,"funding_active"),
                rs.getObject("purchase_channel_id", UUID.class), rs.getString("purchase_channel_name_snapshot"), bool(rs,"purchase_active"),
                rs.getObject("location_label_id", UUID.class), rs.getString("location_label_name_snapshot"), bool(rs,"location_active"),
                rs.getString("display_name"), rs.getObject("payer_id", UUID.class), rs.getString("payer_name_snapshot"), bool(rs,"payer_active"),
                rs.getObject("income_category_id", UUID.class), rs.getString("income_category_name_snapshot"), bool(rs,"income_category_active"),
                rs.getBigDecimal("income_amount"));
    }

    private static boolean bool(DatabaseRow rs, String column) throws SQLException {
        return !rs.isNull(column) && rs.getBoolean(column);
    }
    private static String money(BigDecimal value) { return value.setScale(2).toPlainString(); }

    record SourceRow(UUID id, EntryType entryType, UUID productId, String currentProductName,
            String currentProductNormalized, boolean productActive, UUID primaryCategoryId, String primaryCategoryName,
            boolean primaryActive, UUID secondaryCategoryId, String secondaryCategoryName, boolean secondaryActive,
            UUID unitId, String unitName, boolean unitActive, BigDecimal unitPrice, BigDecimal quantity,
            BigDecimal paidAmount, UUID fundingChannelId, String fundingChannelName, boolean fundingActive,
            UUID purchaseChannelId, String purchaseChannelName, boolean purchaseActive,
            UUID locationLabelId, String locationLabelName, boolean locationActive, String incomeName,
            UUID payerId, String payerName, boolean payerActive, UUID incomeCategoryId,
            String incomeCategoryName, boolean incomeCategoryActive, BigDecimal incomeAmount) { }

    record TemplateRow(UUID id, EntryType entryType, String displayName, UUID productId, String productName,
            boolean productActive, UUID primaryCategoryId, String primaryCategoryName, boolean primaryActive,
            UUID secondaryCategoryId, String secondaryCategoryName, boolean secondaryActive,
            UUID unitId, String unitName, boolean unitActive, BigDecimal unitPrice, BigDecimal quantity,
            BigDecimal paidAmount, UUID fundingChannelId, String fundingChannelName, boolean fundingActive,
            UUID purchaseChannelId, String purchaseChannelName, boolean purchaseActive,
            UUID locationLabelId, String locationLabelName, boolean locationActive, String incomeName,
            UUID payerId, String payerName, boolean payerActive, UUID incomeCategoryId,
            String incomeCategoryName, boolean incomeCategoryActive, BigDecimal incomeAmount) { }
}
