package com.mybill.dictionary;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 商品合并只在已建立 RLS 上下文的事务内迁移稳定引用，并保留账目名称快照。 */
@Repository
class ProductMergeRepository {
    private final JdbcClient jdbc;

    ProductMergeRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<ProductRow> findProduct(UUID id) {
        return jdbc.sql("SELECT id, display_name, normalized_name, status FROM product WHERE id = :id")
                .param("id", id).query(ProductMergeRepository::mapProduct).optional();
    }

    List<ProductRow> lockProducts(UUID firstId, UUID secondId) {
        return jdbc.sql("""
                        SELECT id, display_name, normalized_name, status
                        FROM product
                        WHERE id = :firstId OR id = :secondId
                        ORDER BY id
                        FOR UPDATE
                        """)
                .param("firstId", firstId).param("secondId", secondId)
                .query(ProductMergeRepository::mapProduct).list();
    }

    long countLedgerEntries(UUID productId) {
        return jdbc.sql("SELECT count(*) FROM ledger_entry WHERE product_id = :id")
                .param("id", productId).query(Long.class).single();
    }

    Optional<TemplateRow> findTemplate(UUID productId) {
        return jdbc.sql("""
                        SELECT id, last_used_at, updated_at
                        FROM daily_entry_template
                        WHERE entry_type = 'EXPENSE' AND product_id = :id
                        ORDER BY last_used_at DESC, updated_at DESC, id DESC
                        LIMIT 1
                        """)
                .param("id", productId)
                .query((rs, row) -> new TemplateRow(rs.getObject("id", UUID.class),
                        rs.getTimestamp("last_used_at").toInstant(), rs.getTimestamp("updated_at").toInstant()))
                .optional();
    }

    int updateLedgerProduct(UUID sourceId, UUID targetId) {
        return jdbc.sql("UPDATE ledger_entry SET product_id = :targetId WHERE product_id = :sourceId")
                .param("sourceId", sourceId).param("targetId", targetId).update();
    }

    void moveTemplate(UUID templateId, ProductRow target, Instant now) {
        int affected = jdbc.sql("""
                        UPDATE daily_entry_template
                        SET product_id = :targetId, display_name = :targetName,
                            normalized_name = :targetNormalized, product_name_snapshot = :targetName,
                            updated_at = :now
                        WHERE id = :templateId
                        """)
                .param("targetId", target.id()).param("targetName", target.displayName())
                .param("targetNormalized", target.normalizedName()).param("now", Timestamp.from(now))
                .param("templateId", templateId).update();
        requireSingleRow(affected, "模板迁移");
    }

    void copyTemplatePayload(UUID sourceTemplateId, UUID targetTemplateId, ProductRow target, Instant now) {
        int affected = jdbc.sql("""
                        UPDATE daily_entry_template retained
                        SET source_record_id = source.source_record_id,
                            display_name = :targetName, normalized_name = :targetNormalized,
                            product_id = :targetId, product_name_snapshot = :targetName,
                            primary_category_id = source.primary_category_id,
                            primary_category_name_snapshot = source.primary_category_name_snapshot,
                            secondary_category_id = source.secondary_category_id,
                            secondary_category_name_snapshot = source.secondary_category_name_snapshot,
                            unit_id = source.unit_id, unit_name_snapshot = source.unit_name_snapshot,
                            unit_price = source.unit_price, quantity = source.quantity,
                            paid_amount = source.paid_amount,
                            purchase_channel_id = source.purchase_channel_id,
                            purchase_channel_name_snapshot = source.purchase_channel_name_snapshot,
                            location_label_id = source.location_label_id,
                            location_label_name_snapshot = source.location_label_name_snapshot,
                            funding_channel_id = source.funding_channel_id,
                            funding_channel_name_snapshot = source.funding_channel_name_snapshot,
                            last_used_at = source.last_used_at, updated_at = :now
                        FROM daily_entry_template source
                        WHERE retained.id = :targetTemplateId AND source.id = :sourceTemplateId
                        """)
                .param("targetName", target.displayName()).param("targetNormalized", target.normalizedName())
                .param("targetId", target.id()).param("now", Timestamp.from(now))
                .param("targetTemplateId", targetTemplateId).param("sourceTemplateId", sourceTemplateId).update();
        requireSingleRow(affected, "冲突模板收敛");
    }

    void refreshRetainedTemplate(UUID templateId, ProductRow target, Instant now) {
        moveTemplate(templateId, target, now);
    }

    void deleteTemplate(UUID templateId) {
        requireSingleRow(jdbc.sql("DELETE FROM daily_entry_template WHERE id = :id")
                .param("id", templateId).update(), "冲突模板删除");
    }

    void repointPreviousMerges(UUID sourceId, UUID targetId, Instant now) {
        jdbc.sql("UPDATE product SET merged_into_id = :targetId, updated_at = :now WHERE merged_into_id = :sourceId")
                .param("sourceId", sourceId).param("targetId", targetId).param("now", Timestamp.from(now)).update();
    }

    void markMerged(UUID sourceId, UUID targetId, Instant now) {
        requireSingleRow(jdbc.sql("""
                        UPDATE product
                        SET status = 'MERGED', merged_into_id = :targetId, updated_at = :now
                        WHERE id = :sourceId AND status <> 'MERGED'
                        """)
                .param("sourceId", sourceId).param("targetId", targetId).param("now", Timestamp.from(now)).update(),
                "商品合并状态");
    }

    void insertEvent(UUID eventId, UUID sourceId, UUID targetId, UUID userId, long ledgerCount,
                     int templateCount, boolean templateConflict, Instant now) {
        requireSingleRow(jdbc.sql("""
                        INSERT INTO product_merge_event(
                            tenant_id, id, source_product_id, target_product_id, initiated_by_user_id,
                            affected_ledger_entries, affected_templates, template_conflict, occurred_at)
                        VALUES (current_setting('app.tenant_id')::uuid, :id, :sourceId, :targetId, :userId,
                                :ledgerCount, :templateCount, :templateConflict, :now)
                        """)
                .param("id", eventId).param("sourceId", sourceId).param("targetId", targetId)
                .param("userId", userId).param("ledgerCount", ledgerCount).param("templateCount", templateCount)
                .param("templateConflict", templateConflict).param("now", Timestamp.from(now)).update(),
                "商品合并留痕");
    }

    void renameTemplate(UUID productId, String displayName, String normalizedName, Instant now) {
        jdbc.sql("""
                        UPDATE daily_entry_template
                        SET display_name = :displayName, normalized_name = :normalizedName,
                            product_name_snapshot = :displayName, updated_at = :now
                        WHERE entry_type = 'EXPENSE' AND product_id = :productId
                        """)
                .param("displayName", displayName).param("normalizedName", normalizedName)
                .param("now", Timestamp.from(now)).param("productId", productId).update();
    }

    private static ProductRow mapProduct(ResultSet rs, int rowNumber) throws SQLException {
        return new ProductRow(rs.getObject("id", UUID.class), rs.getString("display_name"),
                rs.getString("normalized_name"), rs.getString("status"));
    }

    private static void requireSingleRow(int affected, String operation) {
        if (affected != 1) throw new IllegalStateException(operation + "未命中唯一记录");
    }

    record ProductRow(UUID id, String displayName, String normalizedName, String status) { }
    record TemplateRow(UUID id, Instant lastUsedAt, Instant updatedAt) { }
}
