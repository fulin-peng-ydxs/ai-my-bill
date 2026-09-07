package com.mybill.ledger;

import com.mybill.dictionary.ExpenseDictionaryService.ExpenseReferences;
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

import static com.mybill.ledger.ExpenseContracts.ExpenseResponse;

/** 支出写入与幂等记录仓储；调用均位于已设置 RLS 上下文的事务中。 */
@Repository
class ExpenseRepository {
    private static final String CREATE_OPERATION = "CREATE_EXPENSE";
    private final MybatisOperations operations;
    private final ExpenseRepositoryMapper mapper;

    ExpenseRepository(MybatisOperations operations, ExpenseRepositoryMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    void insertExpense(UUID id, ExpenseContracts.CreateExpenseRequest request, ExpenseReferences references,
                       BigDecimal unitPrice, BigDecimal quantity, BigDecimal paidAmount,
                       BigDecimal calculatedAmount, LocalDate businessDate, String note, Instant now) {
        operations.update(mapper::insertExpense).param("id", id).param("businessTime", Timestamp.from(request.occurredAt()))
                .param("businessDate", businessDate).param("productId", request.productId())
                .param("productName", references.product().name()).param("primaryId", request.primaryCategoryId())
                .param("primaryName", references.primaryCategory().name()).param("secondaryId", request.secondaryCategoryId())
                .param("secondaryName", name(references.secondaryCategory())).param("unitId", request.unitId())
                .param("unitName", references.unit().name()).param("unitPrice", unitPrice)
                .param("quantity", quantity).param("calculatedAmount", calculatedAmount)
                .param("paidAmount", paidAmount).param("fundingId", request.fundingChannelId())
                .param("fundingName", references.fundingChannel().name()).param("purchaseId", request.purchaseChannelId())
                .param("purchaseName", name(references.purchaseChannel())).param("locationId", request.locationLabelId())
                .param("locationName", name(references.locationLabel())).param("note", note)
                .param("now", Timestamp.from(now)).execute();
    }

    Optional<ExpenseResponse> findExpense(UUID id) {
        return operations.select(mapper::findExpense).param("id", id).map(ExpenseRepository::mapExpense).optional();
    }

    /** 版本条件与字段更新在同一语句完成，避免读后写窗口覆盖并发修改。 */
    boolean updateExpense(UUID id, long version, ExpenseContracts.CreateExpenseRequest request,
                          ExpenseReferences references, BigDecimal unitPrice, BigDecimal quantity,
                          BigDecimal paidAmount, BigDecimal calculatedAmount, LocalDate businessDate,
                          String note, Instant now) {
        return operations.update(mapper::updateExpense).param("businessTime", Timestamp.from(request.occurredAt())).param("businessDate", businessDate)
                .param("productId", request.productId()).param("productName", references.product().name())
                .param("primaryId", request.primaryCategoryId()).param("primaryName", references.primaryCategory().name())
                .param("secondaryId", request.secondaryCategoryId()).param("secondaryName", name(references.secondaryCategory()))
                .param("unitId", request.unitId()).param("unitName", references.unit().name())
                .param("unitPrice", unitPrice).param("quantity", quantity).param("calculatedAmount", calculatedAmount)
                .param("paidAmount", paidAmount).param("fundingId", request.fundingChannelId())
                .param("fundingName", references.fundingChannel().name()).param("purchaseId", request.purchaseChannelId())
                .param("purchaseName", name(references.purchaseChannel())).param("locationId", request.locationLabelId())
                .param("locationName", name(references.locationLabel())).param("note", note)
                .param("now", Timestamp.from(now)).param("id", id).param("version", version).execute() == 1;
    }

    Optional<UUID> deleteUndoableExpense(UUID id, String idempotencyKey) {
        Optional<UUID> productId = operations.select(mapper::deleteUndoableExpense).param("id", id).param("operation", CREATE_OPERATION).param("key", idempotencyKey)
                .param("result", id.toString()).map(UUID.class).optional();
        if (productId.isEmpty()) return Optional.empty();
        int affected = operations.update(mapper::deleteExpense).param("id", id).execute();
        return affected == 1 ? productId : Optional.empty();
    }

    private static String name(com.mybill.dictionary.ExpenseDictionaryService.NamedReference reference) {
        return reference == null ? null : reference.name();
    }

    private static ExpenseResponse mapExpense(DatabaseRow rs, int rowNumber) throws SQLException {
        return new ExpenseResponse(rs.getObject("id", UUID.class), rs.getTimestamp("business_time").toInstant(),
                rs.getObject("business_date", LocalDate.class), rs.getObject("product_id", UUID.class),
                rs.getString("product_name_snapshot"), rs.getObject("primary_category_id", UUID.class),
                rs.getString("primary_category_name_snapshot"), rs.getObject("secondary_category_id", UUID.class),
                rs.getString("secondary_category_name_snapshot"), rs.getObject("unit_id", UUID.class),
                rs.getString("unit_name_snapshot"), decimal(rs.getBigDecimal("unit_price")),
                decimal(rs.getBigDecimal("quantity")), money(rs.getBigDecimal("calculated_amount")),
                money(rs.getBigDecimal("paid_amount")),
                rs.getObject("funding_channel_id", UUID.class), rs.getString("funding_channel_name_snapshot"),
                rs.getObject("purchase_channel_id", UUID.class), rs.getString("purchase_channel_name_snapshot"),
                rs.getObject("location_label_id", UUID.class), rs.getString("location_label_name_snapshot"),
                rs.getString("note"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant(), rs.getLong("version"));
    }

    private static String decimal(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString();
    }

    private static String money(BigDecimal value) {
        return value.setScale(2).toPlainString();
    }

}
