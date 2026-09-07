package com.mybill.ledger;

import com.mybill.ledger.ExpenseAdjustmentContracts.AdjustmentResponse;
import com.mybill.ledger.ExpenseAdjustmentContracts.AdjustmentType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/** 支出调整仓储；所有调用必须处于已设置 RLS 上下文的事务中。 */
@Repository
class ExpenseAdjustmentRepository {
    private final JdbcClient jdbc;

    ExpenseAdjustmentRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    Optional<SourceExpense> lockActiveExpense(UUID expenseId) {
        return jdbc.sql("""
                SELECT id,product_name_snapshot,paid_amount
                  FROM ledger_entry
                 WHERE id=:id AND entry_type='EXPENSE' AND lifecycle_status='ACTIVE'
                 FOR UPDATE
                """).param("id", expenseId).query((rs, row) -> new SourceExpense(
                rs.getObject("id", UUID.class), rs.getString("product_name_snapshot"),
                rs.getBigDecimal("paid_amount"))).optional();
    }

    BigDecimal effectiveTotal(UUID expenseId) {
        return jdbc.sql("""
                SELECT COALESCE(sum(amount),0) FROM expense_adjustment
                 WHERE original_expense_id=:id AND status='EFFECTIVE'
                """).param("id", expenseId).query(BigDecimal.class).single();
    }

    void insert(UUID id, UUID expenseId, AdjustmentType type, BigDecimal amount,
                ExpenseAdjustmentContracts.CreateAdjustmentRequest request,
                LocalDate businessDate, String note, Instant now) {
        jdbc.sql("""
                INSERT INTO expense_adjustment(tenant_id,id,original_expense_id,adjustment_type,amount,
                  business_time,business_date,status,note,created_at,updated_at)
                VALUES(current_setting('app.tenant_id')::uuid,:id,:expenseId,:type,:amount,
                  :businessTime,:businessDate,'EFFECTIVE',:note,:now,:now)
                """).param("id", id).param("expenseId", expenseId).param("type", type.name())
                .param("amount", amount).param("businessTime", Timestamp.from(request.occurredAt()))
                .param("businessDate", businessDate).param("note", note).param("now", Timestamp.from(now)).update();
    }

    Optional<AdjustmentResponse> find(UUID adjustmentId) {
        return jdbc.sql("""
                SELECT a.id,a.original_expense_id,l.product_name_snapshot,a.adjustment_type,a.amount,
                       a.business_time,a.business_date,a.status,a.note,l.paid_amount,
                       (SELECT COALESCE(sum(active.amount),0) FROM expense_adjustment active
                         WHERE active.original_expense_id=a.original_expense_id AND active.status='EFFECTIVE') AS effective_total,
                       a.created_at,a.updated_at,a.version
                  FROM expense_adjustment a
                  JOIN ledger_entry l ON l.tenant_id=a.tenant_id AND l.id=a.original_expense_id
                 WHERE a.id=:id AND a.status IN ('EFFECTIVE','REVOKED')
                """).param("id", adjustmentId).query(ExpenseAdjustmentRepository::map).optional();
    }

    boolean revoke(UUID adjustmentId, long version, Instant now) {
        return jdbc.sql("""
                UPDATE expense_adjustment
                   SET status='REVOKED',updated_at=:now,version=version+1
                 WHERE id=:id AND status='EFFECTIVE' AND version=:version
                """).param("now", Timestamp.from(now)).param("id", adjustmentId).param("version", version)
                .update() == 1;
    }

    private static AdjustmentResponse map(ResultSet rs, int row) throws SQLException {
        BigDecimal paid = rs.getBigDecimal("paid_amount");
        BigDecimal effective = rs.getBigDecimal("effective_total");
        return new AdjustmentResponse(rs.getObject("id", UUID.class),
                rs.getObject("original_expense_id", UUID.class), rs.getString("product_name_snapshot"),
                AdjustmentType.valueOf(rs.getString("adjustment_type")), money(rs.getBigDecimal("amount")),
                rs.getTimestamp("business_time").toInstant(), rs.getObject("business_date", LocalDate.class),
                rs.getString("status"), rs.getString("note"), money(paid), money(effective),
                money(paid.subtract(effective)), effective.compareTo(paid) == 0,
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant(),
                rs.getLong("version"));
    }

    private static String money(BigDecimal value) { return value.setScale(2).toPlainString(); }

    record SourceExpense(UUID id, String title, BigDecimal paidAmount) { }
}
