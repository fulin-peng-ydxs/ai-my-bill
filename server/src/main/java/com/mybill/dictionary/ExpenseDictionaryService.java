package com.mybill.dictionary;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 支出模块使用的显式字典边界；调用方必须先建立同一事务的租户 RLS 上下文。 */
@Service
public class ExpenseDictionaryService {
    private final JdbcClient jdbc;

    public ExpenseDictionaryService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<ProductDefaults> listActiveProducts(String escapedQuery, int limit) {
        return jdbc.sql("""
                SELECT p.id, p.display_name,
                       pc.id AS primary_id, pc.display_name AS primary_name,
                       sc.id AS secondary_id, sc.display_name AS secondary_name,
                       u.id AS unit_id, u.display_name AS unit_name, p.last_unit_price,
                       f.id AS funding_id, f.display_name AS funding_name,
                       ch.id AS purchase_id, ch.display_name AS purchase_name
                  FROM product p
             LEFT JOIN expense_category pc ON pc.id = p.default_primary_category_id AND pc.status = 'ACTIVE'
             LEFT JOIN expense_category sc ON sc.id = p.default_secondary_category_id
                       AND sc.parent_id = pc.id AND sc.status = 'ACTIVE'
             LEFT JOIN unit u ON u.id = p.default_unit_id AND u.status = 'ACTIVE'
             LEFT JOIN funding_channel f ON f.id = p.last_funding_channel_id AND f.status = 'ACTIVE'
             LEFT JOIN purchase_channel ch ON ch.id = p.last_purchase_channel_id AND ch.status = 'ACTIVE'
                 WHERE p.status = 'ACTIVE'
                   AND (:query = '' OR p.normalized_name LIKE ('%' || :query || '%') ESCAPE '\')
              ORDER BY p.updated_at DESC, p.display_name, p.id
                 LIMIT :limit
                """).param("query", escapedQuery).param("limit", limit)
                .query(ExpenseDictionaryService::mapProduct).list();
    }

    public ExpenseReferences lockActiveReferences(UUID productId, UUID primaryCategoryId, UUID secondaryCategoryId,
                                                   UUID unitId, UUID fundingChannelId, UUID purchaseChannelId,
                                                   UUID locationLabelId) {
        ProductDefaults product = lockProduct(productId).orElse(null);
        NamedReference primary = lockNamed("expense_category", primaryCategoryId, "parent_id IS NULL").orElse(null);
        NamedReference secondary = secondaryCategoryId == null ? null
                : lockSecondaryCategory(secondaryCategoryId, primaryCategoryId).orElse(null);
        NamedReference unit = lockNamed("unit", unitId, "TRUE").orElse(null);
        NamedReference funding = lockNamed("funding_channel", fundingChannelId, "TRUE").orElse(null);
        NamedReference purchase = purchaseChannelId == null ? null
                : lockNamed("purchase_channel", purchaseChannelId, "TRUE").orElse(null);
        NamedReference location = locationLabelId == null ? null
                : lockNamed("location_label", locationLabelId, "TRUE").orElse(null);
        return new ExpenseReferences(product, primary, secondary, unit, funding, purchase, location);
    }

    public void updateProductRecentValues(UUID productId, UUID primaryCategoryId, UUID secondaryCategoryId,
                                          UUID unitId, BigDecimal unitPrice, BigDecimal quantity,
                                          UUID fundingChannelId, UUID purchaseChannelId, Instant now) {
        int affected = jdbc.sql("""
                UPDATE product
                   SET default_primary_category_id = :primaryCategoryId,
                       default_secondary_category_id = :secondaryCategoryId,
                       default_unit_id = :unitId,
                       last_unit_price = :unitPrice,
                       last_quantity = :quantity,
                       last_funding_channel_id = :fundingChannelId,
                       last_purchase_channel_id = :purchaseChannelId,
                       updated_at = :now
                 WHERE id = :productId AND status = 'ACTIVE'
                """).param("primaryCategoryId", primaryCategoryId).param("secondaryCategoryId", secondaryCategoryId)
                .param("unitId", unitId).param("unitPrice", unitPrice).param("quantity", quantity)
                .param("fundingChannelId", fundingChannelId).param("purchaseChannelId", purchaseChannelId)
                .param("now", Timestamp.from(now)).param("productId", productId).update();
        if (affected != 1) throw new IllegalStateException("商品最近值写入未命中唯一启用商品");
    }

    public void refreshProductRecentValues(UUID productId, Instant now) {
        jdbc.sql("""
                UPDATE product p
                   SET default_primary_category_id = latest.primary_category_id,
                       default_secondary_category_id = latest.secondary_category_id,
                       default_unit_id = latest.unit_id,
                       last_unit_price = latest.unit_price,
                       last_quantity = latest.quantity,
                       last_funding_channel_id = latest.funding_channel_id,
                       last_purchase_channel_id = latest.purchase_channel_id,
                       updated_at = :now
                  FROM (SELECT :productId::uuid AS product_id) target
             LEFT JOIN LATERAL (
                       SELECT primary_category_id, secondary_category_id, unit_id, unit_price, quantity,
                              funding_channel_id, purchase_channel_id
                         FROM ledger_entry
                        WHERE product_id = target.product_id AND entry_type = 'EXPENSE'
                          AND lifecycle_status = 'ACTIVE'
                     ORDER BY created_at DESC, id DESC
                        LIMIT 1
                       ) latest ON TRUE
                 WHERE p.id = target.product_id AND p.status = 'ACTIVE'
                """).param("productId", productId).param("now", Timestamp.from(now)).update();
    }

    private Optional<ProductDefaults> lockProduct(UUID id) {
        return jdbc.sql("""
                SELECT p.id, p.display_name,
                       pc.id AS primary_id, pc.display_name AS primary_name,
                       sc.id AS secondary_id, sc.display_name AS secondary_name,
                       u.id AS unit_id, u.display_name AS unit_name, p.last_unit_price,
                       f.id AS funding_id, f.display_name AS funding_name,
                       ch.id AS purchase_id, ch.display_name AS purchase_name
                  FROM product p
             LEFT JOIN expense_category pc ON pc.id = p.default_primary_category_id AND pc.status = 'ACTIVE'
             LEFT JOIN expense_category sc ON sc.id = p.default_secondary_category_id
                       AND sc.parent_id = pc.id AND sc.status = 'ACTIVE'
             LEFT JOIN unit u ON u.id = p.default_unit_id AND u.status = 'ACTIVE'
             LEFT JOIN funding_channel f ON f.id = p.last_funding_channel_id AND f.status = 'ACTIVE'
             LEFT JOIN purchase_channel ch ON ch.id = p.last_purchase_channel_id AND ch.status = 'ACTIVE'
                 WHERE p.id = :id AND p.status = 'ACTIVE'
                   FOR UPDATE OF p
                """).param("id", id).query(ExpenseDictionaryService::mapProduct).optional();
    }

    private Optional<NamedReference> lockNamed(String table, UUID id, String extraCondition) {
        return jdbc.sql("SELECT id, display_name FROM " + table
                        + " WHERE id = :id AND status = 'ACTIVE' AND " + extraCondition + " FOR SHARE")
                .param("id", id).query((rs, row) -> new NamedReference(
                        rs.getObject("id", UUID.class), rs.getString("display_name"))).optional();
    }

    private Optional<NamedReference> lockSecondaryCategory(UUID id, UUID primaryCategoryId) {
        return jdbc.sql("""
                SELECT id, display_name
                  FROM expense_category
                 WHERE id = :id AND parent_id = :primaryCategoryId AND status = 'ACTIVE'
                   FOR SHARE
                """).param("id", id).param("primaryCategoryId", primaryCategoryId)
                .query((rs, row) -> new NamedReference(
                        rs.getObject("id", UUID.class), rs.getString("display_name"))).optional();
    }

    private static ProductDefaults mapProduct(ResultSet rs, int rowNumber) throws SQLException {
        return new ProductDefaults(rs.getObject("id", UUID.class), rs.getString("display_name"),
                rs.getObject("primary_id", UUID.class), rs.getString("primary_name"),
                rs.getObject("secondary_id", UUID.class), rs.getString("secondary_name"),
                rs.getObject("unit_id", UUID.class), rs.getString("unit_name"), rs.getBigDecimal("last_unit_price"),
                rs.getObject("funding_id", UUID.class), rs.getString("funding_name"),
                rs.getObject("purchase_id", UUID.class), rs.getString("purchase_name"));
    }

    public record NamedReference(UUID id, String name) { }
    public record ProductDefaults(UUID id, String name, UUID primaryCategoryId, String primaryCategoryName,
                                  UUID secondaryCategoryId, String secondaryCategoryName, UUID unitId,
                                  String unitName, BigDecimal lastUnitPrice, UUID fundingChannelId,
                                  String fundingChannelName, UUID purchaseChannelId, String purchaseChannelName) { }
    public record ExpenseReferences(ProductDefaults product, NamedReference primaryCategory,
                                    NamedReference secondaryCategory, NamedReference unit,
                                    NamedReference fundingChannel, NamedReference purchaseChannel,
                                    NamedReference locationLabel) { }
}
