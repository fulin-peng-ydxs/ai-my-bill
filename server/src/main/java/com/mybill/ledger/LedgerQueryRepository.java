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

/** 当前租户有效收支及生效调整的稳定游标查询；调用方必须先设置数据库 RLS 上下文。 */
@Repository
class LedgerQueryRepository {
    private final JdbcClient jdbc;

    LedgerQueryRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    List<LedgerItem> findPage(Query query, int limit) {
        StringBuilder sql = new StringBuilder("""
                WITH adjustment_totals AS (
                  SELECT original_expense_id,sum(amount) AS effective_total
                    FROM expense_adjustment WHERE status='EFFECTIVE' GROUP BY original_expense_id
                ), items AS (
                  SELECT l.id,l.entry_type,l.business_time,l.business_date,l.created_at,
                    CASE WHEN l.entry_type='EXPENSE' THEN l.product_name_snapshot ELSE l.income_name END AS title,
                    CASE WHEN l.entry_type='EXPENSE' THEN concat_ws(' / ',l.primary_category_name_snapshot,l.secondary_category_name_snapshot)
                         ELSE l.income_category_name_snapshot END AS category_name,
                    CASE WHEN l.entry_type='EXPENSE' THEN concat_ws(' · ',l.quantity || ' ' || l.unit_name_snapshot,
                         l.purchase_channel_name_snapshot,l.location_label_name_snapshot) ELSE l.payer_name_snapshot END AS counterparty_name,
                    l.funding_channel_id,l.funding_channel_name_snapshot,
                    CASE WHEN l.entry_type='EXPENSE' THEN l.paid_amount ELSE l.income_amount END AS amount,l.note,
                    CAST(NULL AS varchar) AS adjustment_type,CAST(NULL AS uuid) AS original_expense_id,
                    CASE WHEN l.entry_type='EXPENSE' THEN COALESCE(t.effective_total,0) END AS effective_adjustment_amount,
                    CASE WHEN l.entry_type='EXPENSE' THEN l.paid_amount-COALESCE(t.effective_total,0) END AS net_expense_amount,
                    l.entry_type='EXPENSE' AND COALESCE(t.effective_total,0)=l.paid_amount AS fully_adjusted,
                    l.version,'ACTIVE' AS lifecycle_status,CAST(NULL AS timestamptz) AS deleted_at,
                    CAST(NULL AS timestamptz) AS purge_after,CAST(NULL AS integer) AS remaining_days,
                    0 AS linked_count,
                    concat_ws(' ',l.product_name_snapshot,l.primary_category_name_snapshot,l.secondary_category_name_snapshot,
                      l.income_name,l.payer_name_snapshot,l.income_category_name_snapshot,l.funding_channel_name_snapshot,
                      l.purchase_channel_name_snapshot,l.location_label_name_snapshot,l.note) AS search_text
                  FROM ledger_entry l LEFT JOIN adjustment_totals t ON t.original_expense_id=l.id
                  WHERE l.lifecycle_status='ACTIVE'
                  UNION ALL
                  SELECT a.id,'ADJUSTMENT',a.business_time,a.business_date,a.created_at,
                    CASE a.adjustment_type WHEN 'REFUND' THEN '退款' ELSE '报销' END,
                    CASE a.adjustment_type WHEN 'REFUND' THEN '支出退款' ELSE '费用报销' END,
                    '原支出 · ' || l.product_name_snapshot,l.funding_channel_id,l.funding_channel_name_snapshot,
                    a.amount,a.note,a.adjustment_type,a.original_expense_id,t.effective_total,
                    l.paid_amount-t.effective_total,t.effective_total=l.paid_amount,
                    a.version,'EFFECTIVE',CAST(NULL AS timestamptz),CAST(NULL AS timestamptz),CAST(NULL AS integer),0,
                    concat_ws(' ',l.product_name_snapshot,l.primary_category_name_snapshot,l.secondary_category_name_snapshot,
                      l.funding_channel_name_snapshot,a.note,
                      CASE a.adjustment_type WHEN 'REFUND' THEN '退款' ELSE '报销' END)
                  FROM expense_adjustment a
                  JOIN ledger_entry l ON l.id=a.original_expense_id AND l.lifecycle_status='ACTIVE'
                  JOIN adjustment_totals t ON t.original_expense_id=a.original_expense_id
                  WHERE a.status='EFFECTIVE'
                )
                SELECT id,entry_type,business_time,business_date,created_at,title,category_name,counterparty_name,
                       funding_channel_name_snapshot,amount,note,adjustment_type,original_expense_id,
                       effective_adjustment_amount,net_expense_amount,fully_adjusted
                       ,version,lifecycle_status,deleted_at,purge_after,remaining_days,linked_count
                  FROM items
                 WHERE business_date BETWEEN :startDate AND :endDate
                """);
        if (query.type() != EntryTypeFilter.ALL) sql.append(" AND entry_type=:entryType");
        if (query.fundingChannelId() != null) sql.append(" AND funding_channel_id=:fundingId");
        if (!query.keyword().isEmpty()) sql.append(" AND search_text ILIKE :keyword ESCAPE '\\'");
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

    List<LedgerItem> findTrashPage(Query query, int limit) {
        StringBuilder sql = new StringBuilder("""
                WITH items AS (
                  SELECT l.id,l.entry_type,l.business_time,l.business_date,l.created_at,
                    CASE WHEN l.entry_type='EXPENSE' THEN l.product_name_snapshot ELSE l.income_name END AS title,
                    CASE WHEN l.entry_type='EXPENSE' THEN concat_ws(' / ',l.primary_category_name_snapshot,l.secondary_category_name_snapshot)
                         ELSE l.income_category_name_snapshot END AS category_name,
                    CASE WHEN l.entry_type='EXPENSE' THEN concat_ws(' · ',l.quantity || ' ' || l.unit_name_snapshot,
                         l.purchase_channel_name_snapshot,l.location_label_name_snapshot) ELSE l.payer_name_snapshot END AS counterparty_name,
                    l.funding_channel_id,l.funding_channel_name_snapshot,
                    CASE WHEN l.entry_type='EXPENSE' THEN l.paid_amount ELSE l.income_amount END AS amount,l.note,
                    CAST(NULL AS varchar) AS adjustment_type,CAST(NULL AS uuid) AS original_expense_id,
                    CAST(NULL AS numeric) AS effective_adjustment_amount,CAST(NULL AS numeric) AS net_expense_amount,false AS fully_adjusted,
                    l.version,l.lifecycle_status,l.deleted_at,l.purge_after,
                    LEAST(30,GREATEST(0,CEIL(EXTRACT(EPOCH FROM (l.purge_after-CURRENT_TIMESTAMP))/86400)))::integer AS remaining_days,
                    (SELECT count(*) FROM expense_adjustment linked WHERE linked.original_expense_id=l.id) AS linked_count,
                    concat_ws(' ',l.product_name_snapshot,l.primary_category_name_snapshot,l.secondary_category_name_snapshot,
                      l.income_name,l.payer_name_snapshot,l.income_category_name_snapshot,l.funding_channel_name_snapshot,
                      l.purchase_channel_name_snapshot,l.location_label_name_snapshot,l.note) AS search_text
                  FROM ledger_entry l WHERE l.lifecycle_status='TRASHED'
                  UNION ALL
                  SELECT a.id,'ADJUSTMENT',a.business_time,a.business_date,a.created_at,
                    CASE a.adjustment_type WHEN 'REFUND' THEN '退款' ELSE '报销' END,
                    CASE a.adjustment_type WHEN 'REFUND' THEN '支出退款' ELSE '费用报销' END,
                    '原支出 · ' || l.product_name_snapshot,l.funding_channel_id,l.funding_channel_name_snapshot,
                    a.amount,a.note,a.adjustment_type,a.original_expense_id,CAST(NULL AS numeric),CAST(NULL AS numeric),false,
                    a.version,a.status,a.deleted_at,a.purge_after,
                    LEAST(30,GREATEST(0,CEIL(EXTRACT(EPOCH FROM (a.purge_after-CURRENT_TIMESTAMP))/86400)))::integer,0,
                    concat_ws(' ',l.product_name_snapshot,l.primary_category_name_snapshot,l.secondary_category_name_snapshot,
                      l.funding_channel_name_snapshot,a.note,CASE a.adjustment_type WHEN 'REFUND' THEN '退款' ELSE '报销' END)
                  FROM expense_adjustment a JOIN ledger_entry l ON l.id=a.original_expense_id
                  WHERE a.status='TRASHED'
                )
                SELECT id,entry_type,business_time,business_date,created_at,title,category_name,counterparty_name,
                       funding_channel_name_snapshot,amount,note,adjustment_type,original_expense_id,
                       effective_adjustment_amount,net_expense_amount,fully_adjusted,version,lifecycle_status,
                       deleted_at,purge_after,remaining_days,linked_count
                  FROM items WHERE business_date BETWEEN :startDate AND :endDate
                """);
        if (query.type() != EntryTypeFilter.ALL) sql.append(" AND entry_type=:entryType");
        if (query.fundingChannelId() != null) sql.append(" AND funding_channel_id=:fundingId");
        if (!query.keyword().isEmpty()) sql.append(" AND search_text ILIKE :keyword ESCAPE '\\'");
        if (query.cursor() != null) sql.append(" AND (deleted_at,id)<(:cursorDeleted,:cursorId)");
        sql.append(" ORDER BY deleted_at DESC,id DESC LIMIT :limit");
        JdbcClient.StatementSpec statement = jdbc.sql(sql.toString()).param("startDate", query.startDate())
                .param("endDate", query.endDate()).param("limit", limit);
        if (query.type() != EntryTypeFilter.ALL) statement = statement.param("entryType", query.type().name());
        if (query.fundingChannelId() != null) statement = statement.param("fundingId", query.fundingChannelId());
        if (!query.keyword().isEmpty()) statement = statement.param("keyword", "%" + escapeLike(query.keyword()) + "%");
        if (query.cursor() != null) statement = statement.param("cursorDeleted", Timestamp.from(query.cursor().deletedAt()))
                .param("cursorId", query.cursor().id());
        return statement.query(LedgerQueryRepository::map).list();
    }

    private static LedgerItem map(ResultSet rs, int row) throws SQLException {
        return new LedgerItem(rs.getObject("id", UUID.class), rs.getString("entry_type"),
                rs.getTimestamp("business_time").toInstant(), rs.getObject("business_date", LocalDate.class),
                rs.getString("title"), rs.getString("category_name"), rs.getString("counterparty_name"),
                rs.getString("funding_channel_name_snapshot"), money(rs.getBigDecimal("amount")), rs.getString("note"),
                rs.getTimestamp("created_at").toInstant(), rs.getString("adjustment_type"),
                rs.getObject("original_expense_id", UUID.class), nullableMoney(rs.getBigDecimal("effective_adjustment_amount")),
                nullableMoney(rs.getBigDecimal("net_expense_amount")), rs.getBoolean("fully_adjusted"),
                rs.getLong("version"), rs.getString("lifecycle_status"), nullableInstant(rs, "deleted_at"),
                nullableInstant(rs, "purge_after"), (Integer) rs.getObject("remaining_days"), rs.getInt("linked_count"));
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static String money(BigDecimal value) { return value.setScale(2).toPlainString(); }
    private static String nullableMoney(BigDecimal value) { return value == null ? null : money(value); }
    private static Instant nullableInstant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column); return value == null ? null : value.toInstant();
    }

    record Query(LocalDate startDate, LocalDate endDate, EntryTypeFilter type, UUID fundingChannelId,
                 String keyword, Cursor cursor) { }
    record Cursor(LocalDate businessDate, Instant businessTime, Instant createdAt, Instant deletedAt, UUID id) { }
}
