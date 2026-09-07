package com.mybill.ledger;

import com.mybill.ledger.ExpenseAdjustmentContracts.AdjustmentResponse;
import com.mybill.ledger.ExpenseAdjustmentContracts.AdjustmentType;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/** 支出调整仓储；所有调用必须处于已设置 RLS 上下文的事务中。 */
@Repository
class ExpenseAdjustmentRepository {
    private final MybatisOperations operations;
    private final ExpenseAdjustmentRepositoryMapper mapper;

    ExpenseAdjustmentRepository(MybatisOperations operations, ExpenseAdjustmentRepositoryMapper mapper) { this.operations = operations; this.mapper = mapper; }

    Optional<SourceExpense> lockActiveExpense(UUID expenseId) {
        return operations.select(mapper::lockActiveExpense).param("id", expenseId).map((rs, row) -> new SourceExpense(
                rs.getObject("id", UUID.class), rs.getString("product_name_snapshot"),
                rs.getBigDecimal("paid_amount"))).optional();
    }

    BigDecimal effectiveTotal(UUID expenseId) {
        return operations.select(mapper::effectiveTotal).param("id", expenseId).map(BigDecimal.class).single();
    }

    void insert(UUID id, UUID expenseId, AdjustmentType type, BigDecimal amount,
                ExpenseAdjustmentContracts.CreateAdjustmentRequest request,
                LocalDate businessDate, String note, Instant now) {
        operations.update(mapper::insert).param("id", id).param("expenseId", expenseId).param("type", type.name())
                .param("amount", amount).param("businessTime", Timestamp.from(request.occurredAt()))
                .param("businessDate", businessDate).param("note", note).param("now", Timestamp.from(now)).execute();
    }

    Optional<AdjustmentResponse> find(UUID adjustmentId) {
        return operations.select(mapper::find).param("id", adjustmentId).map(ExpenseAdjustmentRepository::map).optional();
    }

    boolean revoke(UUID adjustmentId, long version, Instant now) {
        return operations.update(mapper::revoke).param("now", Timestamp.from(now)).param("id", adjustmentId).param("version", version)
                .execute() == 1;
    }

    private static AdjustmentResponse map(DatabaseRow rs, int row) throws SQLException {
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
