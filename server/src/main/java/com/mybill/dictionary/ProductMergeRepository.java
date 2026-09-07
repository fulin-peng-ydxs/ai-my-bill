package com.mybill.dictionary;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 商品合并只在已建立 RLS 上下文的事务内迁移稳定引用，并保留账目名称快照。 */
@Repository
class ProductMergeRepository {
    private final MybatisOperations operations;
    private final ProductMergeRepositoryMapper mapper;

    ProductMergeRepository(MybatisOperations operations, ProductMergeRepositoryMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    Optional<ProductRow> findProduct(UUID id) {
        return operations.select(mapper::findProduct)
                .param("id", id).map(ProductMergeRepository::mapProduct).optional();
    }

    List<ProductRow> lockProducts(UUID firstId, UUID secondId) {
        return operations.select(mapper::lockProducts)
                .param("firstId", firstId).param("secondId", secondId)
                .map(ProductMergeRepository::mapProduct).list();
    }

    long countLedgerEntries(UUID productId) {
        return operations.select(mapper::countLedgerEntries)
                .param("id", productId).map(Long.class).single();
    }

    Optional<TemplateRow> findTemplate(UUID productId) {
        return operations.select(mapper::findTemplate)
                .param("id", productId)
                .map((rs, row) -> new TemplateRow(rs.getObject("id", UUID.class),
                        rs.getTimestamp("last_used_at").toInstant(), rs.getTimestamp("updated_at").toInstant()))
                .optional();
    }

    int updateLedgerProduct(UUID sourceId, UUID targetId) {
        return operations.update(mapper::updateLedgerProduct)
                .param("sourceId", sourceId).param("targetId", targetId).execute();
    }

    void moveTemplate(UUID templateId, ProductRow target, Instant now) {
        int affected = operations.update(mapper::moveTemplate)
                .param("targetId", target.id()).param("targetName", target.displayName())
                .param("targetNormalized", target.normalizedName()).param("now", Timestamp.from(now))
                .param("templateId", templateId).execute();
        requireSingleRow(affected, "模板迁移");
    }

    void copyTemplatePayload(UUID sourceTemplateId, UUID targetTemplateId, ProductRow target, Instant now) {
        int affected = operations.update(mapper::copyTemplatePayload)
                .param("targetName", target.displayName()).param("targetNormalized", target.normalizedName())
                .param("targetId", target.id()).param("now", Timestamp.from(now))
                .param("targetTemplateId", targetTemplateId).param("sourceTemplateId", sourceTemplateId).execute();
        requireSingleRow(affected, "冲突模板收敛");
    }

    void refreshRetainedTemplate(UUID templateId, ProductRow target, Instant now) {
        moveTemplate(templateId, target, now);
    }

    void deleteTemplate(UUID templateId) {
        requireSingleRow(operations.update(mapper::deleteTemplate)
                .param("id", templateId).execute(), "冲突模板删除");
    }

    void repointPreviousMerges(UUID sourceId, UUID targetId, Instant now) {
        operations.update(mapper::repointPreviousMerges)
                .param("sourceId", sourceId).param("targetId", targetId).param("now", Timestamp.from(now)).execute();
    }

    void markMerged(UUID sourceId, UUID targetId, Instant now) {
        requireSingleRow(operations.update(mapper::markMerged)
                .param("sourceId", sourceId).param("targetId", targetId).param("now", Timestamp.from(now)).execute(),
                "商品合并状态");
    }

    void insertEvent(UUID eventId, UUID sourceId, UUID targetId, UUID userId, long ledgerCount,
                     int templateCount, boolean templateConflict, Instant now) {
        requireSingleRow(operations.update(mapper::insertEvent)
                .param("id", eventId).param("sourceId", sourceId).param("targetId", targetId)
                .param("userId", userId).param("ledgerCount", ledgerCount).param("templateCount", templateCount)
                .param("templateConflict", templateConflict).param("now", Timestamp.from(now)).execute(),
                "商品合并留痕");
    }

    void renameTemplate(UUID productId, String displayName, String normalizedName, Instant now) {
        operations.update(mapper::renameTemplate)
                .param("displayName", displayName).param("normalizedName", normalizedName)
                .param("now", Timestamp.from(now)).param("productId", productId).execute();
    }

    private static ProductRow mapProduct(DatabaseRow rs, int rowNumber) throws SQLException {
        return new ProductRow(rs.getObject("id", UUID.class), rs.getString("display_name"),
                rs.getString("normalized_name"), rs.getString("status"));
    }

    private static void requireSingleRow(int affected, String operation) {
        if (affected != 1) throw new IllegalStateException(operation + "未命中唯一记录");
    }

    record ProductRow(UUID id, String displayName, String normalizedName, String status) { }
    record TemplateRow(UUID id, Instant lastUsedAt, Instant updatedAt) { }
}
