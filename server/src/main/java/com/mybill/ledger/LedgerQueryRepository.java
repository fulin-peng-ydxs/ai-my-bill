package com.mybill.ledger;

import com.mybill.ledger.LedgerQueryContracts.EntryTypeFilter;
import com.mybill.ledger.LedgerQueryContracts.LedgerItem;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** 当前租户有效收支的稳定游标查询；调用方必须先设置数据库 RLS 上下文。 */
@Repository
class LedgerQueryRepository {
    private final JdbcClient jdbc;

    LedgerQueryRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    List<LedgerItem> findPage(Query query, int limit) {
        StringBuilder sql = new StringBuilder("""
                SELECT id,entry_type,business_time,business_date,created_at,
                  CASE WHEN entry_type='EXPENSE' THEN product_name_snapshot ELSE income_name END AS title,
                  CASE WHEN entry_type='EXPENSE' THEN concat_ws(' / ',primary_category_name_snapshot,secondary_category_name_snapshot)
                       ELSE income_category_name_snapshot END AS category_name,
                  CASE WHEN entry_type='EXPENSE' THEN concat_ws(' · ',quantity || ' ' || unit_name_snapshot,
                       CASE WHEN purchase_channel_name_snapshot IS NULL THEN NULL ELSE purchase_channel_name_snapshot END,
                       CASE WHEN location_label_name_snapshot IS NULL THEN NULL ELSE location_label_name_snapshot END)
                       ELSE payer_name_snapshot END AS counterparty_name,
                  funding_channel_name_snapshot,
                  CASE WHEN entry_type='EXPENSE' THEN paid_amount ELSE income_amount END AS amount,note
                FROM ledger_entry
                WHERE lifecycle_status='ACTIVE' AND business_date BETWEEN :startDate AND :endDate
                """);
        if (query.type() != EntryTypeFilter.ALL) sql.append(" AND entry_type=:entryType");
        if (query.fundingChannelId() != null) sql.append(" AND funding_channel_id=:fundingId");
        if (!query.keyword().isEmpty()) sql.append("""
                 AND concat_ws(' ',product_name_snapshot,primary_category_name_snapshot,secondary_category_name_snapshot,
                   income_name,payer_name_snapshot,income_category_name_snapshot,funding_channel_name_snapshot,
                   purchase_channel_name_snapshot,location_label_name_snapshot,note) ILIKE :keyword ESCAPE '\\'
                """);
        if (query.cursor() != null) sql.append("""
                 AND (business_date,business_time,created_at,id) < (:cursorDate,:cursorTime,:cursorCreated,:cursorId)
                """);
        sql.append(" ORDER BY business_date DESC,business_time DESC,created_at DESC,id DESC LIMIT :limit");

        JdbcClient.StatementSpec statement = jdbc.sql(sql.toString())
                .param("startDate", query.startDate()).param("endDate", query.endDate()).param("limit", limit);
        if (query.type() != EntryTypeFilter.ALL) statement = statement.param("entryType", query.type().name());
        if (query.fundingChannelId() != null) statement = statement.param("fundingId", query.fundingChannelId());
        if (!query.keyword().isEmpty()) statement = statement.param("keyword", "%" + escapeLike(query.keyword()) + "%");
        if (query.cursor() != null) {
            Cursor cursor = query.cursor();
            statement = statement.param("cursorDate", cursor.businessDate())
                    .param("cursorTime", Timestamp.from(cursor.businessTime()))
                    .param("cursorCreated", Timestamp.from(cursor.createdAt())).param("cursorId", cursor.id());
        }
        return statement.query(LedgerQueryRepository::map).list();
    }

    private static LedgerItem map(ResultSet rs, int row) throws SQLException {
        return new LedgerItem(rs.getObject("id", UUID.class), rs.getString("entry_type"),
                rs.getTimestamp("business_time").toInstant(), rs.getObject("business_date", LocalDate.class),
                rs.getString("title"), rs.getString("category_name"), rs.getString("counterparty_name"),
                rs.getString("funding_channel_name_snapshot"), money(rs.getBigDecimal("amount")), rs.getString("note"),
                rs.getTimestamp("created_at").toInstant());
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static String money(BigDecimal value) { return value.setScale(2).toPlainString(); }

    record Query(LocalDate startDate, LocalDate endDate, EntryTypeFilter type, UUID fundingChannelId,
                 String keyword, Cursor cursor) { }
    record Cursor(LocalDate businessDate, Instant businessTime, Instant createdAt, UUID id) { }
}
