package com.mybill.dictionary;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 支出模块使用的显式字典边界；调用方必须先建立同一事务的租户 RLS 上下文。 */
@Service
public class ExpenseDictionaryService {
    private final MybatisOperations operations;
    private final ExpenseDictionaryServiceMapper mapper;

    public ExpenseDictionaryService(MybatisOperations operations, ExpenseDictionaryServiceMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    public List<ProductDefaults> listActiveProducts(String escapedQuery, int limit) {
        return operations.select(mapper::listActiveProducts).param("query", escapedQuery).param("limit", limit)
                .map(ExpenseDictionaryService::mapProduct).list();
    }

    public ExpenseReferences lockActiveReferences(UUID productId, UUID primaryCategoryId, UUID secondaryCategoryId,
                                                   UUID unitId, UUID fundingChannelId, UUID purchaseChannelId,
                                                   UUID locationLabelId) {
        ProductDefaults product = lockProduct(productId).orElse(null);
        NamedReference primary = lockNamed("PRIMARY_CATEGORY", primaryCategoryId).orElse(null);
        NamedReference secondary = secondaryCategoryId == null ? null
                : lockSecondaryCategory(secondaryCategoryId, primaryCategoryId).orElse(null);
        NamedReference unit = lockNamed("UNIT", unitId).orElse(null);
        NamedReference funding = lockNamed("FUNDING_CHANNEL", fundingChannelId).orElse(null);
        NamedReference purchase = purchaseChannelId == null ? null
                : lockNamed("PURCHASE_CHANNEL", purchaseChannelId).orElse(null);
        NamedReference location = locationLabelId == null ? null
                : lockNamed("LOCATION", locationLabelId).orElse(null);
        return new ExpenseReferences(product, primary, secondary, unit, funding, purchase, location);
    }

    public void updateProductRecentValues(UUID productId, UUID primaryCategoryId, UUID secondaryCategoryId,
                                          UUID unitId, BigDecimal unitPrice, BigDecimal quantity,
                                          UUID fundingChannelId, UUID purchaseChannelId, Instant now) {
        int affected = operations.update(mapper::updateProductRecentValues).param("primaryCategoryId", primaryCategoryId).param("secondaryCategoryId", secondaryCategoryId)
                .param("unitId", unitId).param("unitPrice", unitPrice).param("quantity", quantity)
                .param("fundingChannelId", fundingChannelId).param("purchaseChannelId", purchaseChannelId)
                .param("now", Timestamp.from(now)).param("productId", productId).execute();
        if (affected != 1) throw new IllegalStateException("商品最近值写入未命中唯一启用商品");
    }

    public void refreshProductRecentValues(UUID productId, Instant now) {
        operations.update(mapper::refreshProductRecentValues).param("productId", productId).param("now", Timestamp.from(now)).execute();
    }

    private Optional<ProductDefaults> lockProduct(UUID id) {
        return operations.select(mapper::lockProduct).param("id", id).map(ExpenseDictionaryService::mapProduct).optional();
    }

    private Optional<NamedReference> lockNamed(String type, UUID id) {
        return operations.select(mapper::lockNamed).param("type", type).param("id", id)
                .map((rs, row) -> new NamedReference(
                        rs.getObject("id", UUID.class), rs.getString("display_name"))).optional();
    }

    private Optional<NamedReference> lockSecondaryCategory(UUID id, UUID primaryCategoryId) {
        return operations.select(mapper::lockSecondaryCategory).param("id", id).param("primaryCategoryId", primaryCategoryId)
                .map((rs, row) -> new NamedReference(
                        rs.getObject("id", UUID.class), rs.getString("display_name"))).optional();
    }

    private static ProductDefaults mapProduct(DatabaseRow rs, int rowNumber) throws SQLException {
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
