package com.mybill.ledger;

import com.mybill.ledger.DailyTemplateContracts.EntryType;
import com.mybill.ledger.DailyTemplateContracts.TemplateSummary;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 日常模板仓储；所有方法必须在已设置 RLS 租户上下文的事务内调用。 */
@Repository
class DailyTemplateRepository {
    private final JdbcClient jdbc;
    DailyTemplateRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    Optional<SourceRow> lockActiveSource(UUID id) {
        return jdbc.sql("""
                SELECT l.*, p.display_name AS current_product_name, p.normalized_name AS current_product_normalized,
                  p.status='ACTIVE' AS product_active,
                  pc.status='ACTIVE' AS primary_active, sc.status='ACTIVE' AS secondary_active,
                  u.status='ACTIVE' AS unit_active, f.status='ACTIVE' AS funding_active,
                  ch.status='ACTIVE' AS purchase_active, loc.status='ACTIVE' AS location_active,
                  py.status='ACTIVE' AS payer_active, ic.status='ACTIVE' AS income_category_active
                FROM ledger_entry l
                LEFT JOIN product p ON p.id=l.product_id
                LEFT JOIN expense_category pc ON pc.id=l.primary_category_id
                LEFT JOIN expense_category sc ON sc.id=l.secondary_category_id
                LEFT JOIN unit u ON u.id=l.unit_id
                LEFT JOIN funding_channel f ON f.id=l.funding_channel_id
                LEFT JOIN purchase_channel ch ON ch.id=l.purchase_channel_id
                LEFT JOIN location_label loc ON loc.id=l.location_label_id
                LEFT JOIN payer py ON py.id=l.payer_id
                LEFT JOIN income_category ic ON ic.id=l.income_category_id
                WHERE l.id=:id AND l.lifecycle_status='ACTIVE'
                FOR UPDATE OF l
                """).param("id", id).query(DailyTemplateRepository::mapSource).optional();
    }

    TemplateSummary upsert(SourceRow source, String displayName, String normalizedName, Instant now) {
        UUID id = UUID.randomUUID();
        return jdbc.sql("""
                INSERT INTO daily_entry_template(
                  tenant_id,id,entry_type,display_name,normalized_name,source_record_id,
                  product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,
                  secondary_category_id,secondary_category_name_snapshot,unit_id,unit_name_snapshot,
                  unit_price,quantity,paid_amount,purchase_channel_id,purchase_channel_name_snapshot,
                  location_label_id,location_label_name_snapshot,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,
                  funding_channel_id,funding_channel_name_snapshot,last_used_at,created_at,updated_at)
                VALUES(current_setting('app.tenant_id')::uuid,:id,:type,:display,:normalized,:source,
                  :productId,:productName,:primaryId,:primaryName,:secondaryId,:secondaryName,:unitId,:unitName,
                  :unitPrice,:quantity,:paidAmount,:purchaseId,:purchaseName,:locationId,:locationName,
                  :payerId,:payerName,:incomeCategoryId,:incomeCategoryName,:incomeAmount,
                  :fundingId,:fundingName,:now,:now,:now)
                ON CONFLICT (tenant_id,entry_type,normalized_name) DO UPDATE SET
                  source_record_id=EXCLUDED.source_record_id, display_name=EXCLUDED.display_name,
                  product_id=EXCLUDED.product_id, product_name_snapshot=EXCLUDED.product_name_snapshot,
                  primary_category_id=EXCLUDED.primary_category_id,
                  primary_category_name_snapshot=EXCLUDED.primary_category_name_snapshot,
                  secondary_category_id=EXCLUDED.secondary_category_id,
                  secondary_category_name_snapshot=EXCLUDED.secondary_category_name_snapshot,
                  unit_id=EXCLUDED.unit_id, unit_name_snapshot=EXCLUDED.unit_name_snapshot,
                  unit_price=EXCLUDED.unit_price, quantity=EXCLUDED.quantity, paid_amount=EXCLUDED.paid_amount,
                  purchase_channel_id=EXCLUDED.purchase_channel_id,
                  purchase_channel_name_snapshot=EXCLUDED.purchase_channel_name_snapshot,
                  location_label_id=EXCLUDED.location_label_id,
                  location_label_name_snapshot=EXCLUDED.location_label_name_snapshot,
                  payer_id=EXCLUDED.payer_id, payer_name_snapshot=EXCLUDED.payer_name_snapshot,
                  income_category_id=EXCLUDED.income_category_id,
                  income_category_name_snapshot=EXCLUDED.income_category_name_snapshot,
                  income_amount=EXCLUDED.income_amount, funding_channel_id=EXCLUDED.funding_channel_id,
                  funding_channel_name_snapshot=EXCLUDED.funding_channel_name_snapshot,
                  last_used_at=EXCLUDED.last_used_at, updated_at=EXCLUDED.updated_at
                RETURNING id,entry_type,display_name,
                  CASE WHEN entry_type='EXPENSE' THEN paid_amount ELSE income_amount END AS amount,
                  CASE WHEN entry_type='EXPENSE' THEN primary_category_name_snapshot ELSE payer_name_snapshot END AS context_name,
                  last_used_at
                """)
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
                .query(DailyTemplateRepository::mapSummary).single();
    }

    List<TemplateSummary> list(EntryType type) {
        return jdbc.sql("""
                SELECT id,entry_type,display_name,
                  CASE WHEN entry_type='EXPENSE' THEN paid_amount ELSE income_amount END AS amount,
                  CASE WHEN entry_type='EXPENSE' THEN primary_category_name_snapshot ELSE payer_name_snapshot END AS context_name,
                  last_used_at
                FROM daily_entry_template WHERE entry_type=:type
                ORDER BY last_used_at DESC,id DESC LIMIT 100
                """).param("type", type.name()).query(DailyTemplateRepository::mapSummary).list();
    }

    Optional<TemplateRow> lockTemplate(UUID id) {
        return jdbc.sql("""
                SELECT t.*,
                  p.status='ACTIVE' AS product_active, pc.status='ACTIVE' AS primary_active,
                  sc.status='ACTIVE' AS secondary_active, u.status='ACTIVE' AS unit_active,
                  f.status='ACTIVE' AS funding_active, ch.status='ACTIVE' AS purchase_active,
                  loc.status='ACTIVE' AS location_active, py.status='ACTIVE' AS payer_active,
                  ic.status='ACTIVE' AS income_category_active
                FROM daily_entry_template t
                LEFT JOIN product p ON p.id=t.product_id
                LEFT JOIN expense_category pc ON pc.id=t.primary_category_id
                LEFT JOIN expense_category sc ON sc.id=t.secondary_category_id
                LEFT JOIN unit u ON u.id=t.unit_id
                LEFT JOIN funding_channel f ON f.id=t.funding_channel_id
                LEFT JOIN purchase_channel ch ON ch.id=t.purchase_channel_id
                LEFT JOIN location_label loc ON loc.id=t.location_label_id
                LEFT JOIN payer py ON py.id=t.payer_id
                LEFT JOIN income_category ic ON ic.id=t.income_category_id
                WHERE t.id=:id FOR UPDATE OF t
                """).param("id", id).query(DailyTemplateRepository::mapTemplate).optional();
    }

    void touch(UUID id, Instant now) {
        if (jdbc.sql("UPDATE daily_entry_template SET last_used_at=:now,updated_at=:now WHERE id=:id")
                .param("now", Timestamp.from(now)).param("id", id).update() != 1) {
            throw new IllegalStateException("日常模板最近使用时间更新未命中唯一记录");
        }
    }

    boolean delete(UUID id) {
        return jdbc.sql("DELETE FROM daily_entry_template WHERE id=:id").param("id", id).update() == 1;
    }

    private static TemplateSummary mapSummary(ResultSet rs, int row) throws SQLException {
        return new TemplateSummary(rs.getObject("id", UUID.class), EntryType.valueOf(rs.getString("entry_type")),
                rs.getString("display_name"), money(rs.getBigDecimal("amount")), rs.getString("context_name"),
                rs.getTimestamp("last_used_at").toInstant());
    }

    private static SourceRow mapSource(ResultSet rs, int row) throws SQLException {
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

    private static TemplateRow mapTemplate(ResultSet rs, int row) throws SQLException {
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

    private static boolean bool(ResultSet rs, String column) throws SQLException { return rs.getBoolean(column) && !rs.wasNull(); }
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
