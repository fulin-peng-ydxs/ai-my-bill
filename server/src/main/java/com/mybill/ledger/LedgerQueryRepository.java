package com.mybill.ledger;

import com.mybill.ledger.LedgerQueryContracts.EntryTypeFilter;
import com.mybill.ledger.LedgerQueryContracts.LedgerItem;
import com.mybill.shared.persistence.DatabaseRow;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** 当前租户有效收支及生效调整的稳定游标查询；调用方必须先设置数据库 RLS 上下文。 */
@Repository
class LedgerQueryRepository {
    private final MybatisOperations operations;
    private final LedgerQueryRepositoryMapper mapper;

    LedgerQueryRepository(MybatisOperations operations, LedgerQueryRepositoryMapper mapper) {
        this.operations = operations;
        this.mapper = mapper;
    }

    List<LedgerItem> findPage(Query query, int limit) {
        MybatisOperations.SelectSpec spec = base(mapper::findPage, query, limit);
        if (query.cursor() != null) {
            spec.param("cursorDate", query.cursor().businessDate())
                    .param("cursorTime", Timestamp.from(query.cursor().businessTime()))
                    .param("cursorCreated", Timestamp.from(query.cursor().createdAt()))
                    .param("cursorId", query.cursor().id());
        }
        return spec.map(LedgerQueryRepository::map).list();
    }

    List<LedgerItem> findTrashPage(Query query, int limit) {
        MybatisOperations.SelectSpec spec = base(mapper::findTrashPage, query, limit);
        if (query.cursor() != null) {
            spec.param("cursorDeleted", Timestamp.from(query.cursor().deletedAt()))
                    .param("cursorId", query.cursor().id());
        }
        return spec.map(LedgerQueryRepository::map).list();
    }

    private MybatisOperations.SelectSpec base(
            java.util.function.Function<java.util.Map<String, Object>, java.util.List<java.util.Map<String, Object>>> method,
            Query query, int limit) {
        return operations.select(method).param("startDate", query.startDate()).param("endDate", query.endDate())
                .param("limit", limit).param("entryType", query.type() == EntryTypeFilter.ALL || query.type() == EntryTypeFilter.EXPENSE_FLOW ? null : query.type().name())
                .param("expenseFlow", query.type() == EntryTypeFilter.EXPENSE_FLOW)
                .param("fundingId", query.fundingChannelId())
                .param("primaryCategoryId", query.primaryCategoryId())
                .param("secondaryCategoryId", query.secondaryCategoryId())
                .param("productId", query.productId())
                .param("unitId", query.unitId()).param("entryId", query.entryId())
                .param("purchaseChannelId", query.purchaseChannelId())
                .param("locationLabelId", query.locationLabelId())
                .param("missingSecondaryCategory", query.missingSecondaryCategory())
                .param("missingPurchaseChannel", query.missingPurchaseChannel())
                .param("missingLocation", query.missingLocation())
                .param("expenseWeekday", query.expenseWeekday())
                .param("expenseTimeBand", query.expenseTimeBand() == null ? null : query.expenseTimeBand().name())
                .param("incomeCategoryId", query.incomeCategoryId())
                .param("payerId", query.payerId()).param("incomeName", query.incomeName())
                .param("keyword", query.keyword().isEmpty() ? null : "%" + escapeLike(query.keyword()) + "%")
                .param("now", Timestamp.from(query.now()))
                .param("hasCursor", query.cursor() != null);
    }

    private static LedgerItem map(DatabaseRow row, int index) throws SQLException {
        return new LedgerItem(row.getObject("id", UUID.class), row.getString("entry_type"),
                row.getTimestamp("business_time").toInstant(), row.getObject("business_date", LocalDate.class),
                row.getString("title"), row.getString("category_name"), row.getString("counterparty_name"),
                row.getString("funding_channel_name_snapshot"), money(row.getBigDecimal("amount")), row.getString("note"),
                row.getTimestamp("created_at").toInstant(), row.getString("adjustment_type"),
                row.getObject("original_expense_id", UUID.class), nullableMoney(row.getBigDecimal("effective_adjustment_amount")),
                nullableMoney(row.getBigDecimal("net_expense_amount")), row.getBoolean("fully_adjusted"),
                row.getLong("version"), row.getString("lifecycle_status"), nullableInstant(row, "deleted_at"),
                nullableInstant(row, "purge_after"), (Integer) row.getObject("remaining_days"), row.getInt("linked_count"));
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
    private static String money(BigDecimal value) { return value.setScale(2).toPlainString(); }
    private static String nullableMoney(BigDecimal value) { return value == null ? null : money(value); }
    private static Instant nullableInstant(DatabaseRow row, String column) throws SQLException {
        Timestamp value = row.getTimestamp(column); return value == null ? null : value.toInstant();
    }

    record Query(LocalDate startDate, LocalDate endDate, EntryTypeFilter type, UUID fundingChannelId,
                 UUID primaryCategoryId, UUID secondaryCategoryId, UUID productId,
                 UUID purchaseChannelId, UUID locationLabelId, UUID unitId, UUID entryId,
                 boolean missingSecondaryCategory, boolean missingPurchaseChannel, boolean missingLocation,
                 Integer expenseWeekday, LedgerQueryContracts.ExpenseTimeBand expenseTimeBand,
                 UUID incomeCategoryId, UUID payerId, String incomeName,
                 String keyword, Cursor cursor, Instant now) { }
    record Cursor(LocalDate businessDate, Instant businessTime, Instant createdAt, Instant deletedAt, UUID id) { }
}
