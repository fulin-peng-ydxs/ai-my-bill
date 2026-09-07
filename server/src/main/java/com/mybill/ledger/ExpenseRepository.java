package com.mybill.ledger;

import com.mybill.dictionary.ExpenseDictionaryService.ExpenseReferences;
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

import static com.mybill.ledger.ExpenseContracts.ExpenseResponse;

/** 支出写入与幂等记录仓储；调用均位于已设置 RLS 上下文的事务中。 */
@Repository
class ExpenseRepository {
    private static final String CREATE_OPERATION = "CREATE_EXPENSE";
    private final JdbcClient jdbc;

    ExpenseRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insertExpense(UUID id, ExpenseContracts.CreateExpenseRequest request, ExpenseReferences references,
                       BigDecimal unitPrice, BigDecimal quantity, BigDecimal paidAmount,
                       BigDecimal calculatedAmount, LocalDate businessDate, String note, Instant now) {
        jdbc.sql("""
                INSERT INTO ledger_entry(
                    tenant_id, id, entry_type, business_time, business_date,
                    product_id, product_name_snapshot,
                    primary_category_id, primary_category_name_snapshot,
                    secondary_category_id, secondary_category_name_snapshot,
                    unit_id, unit_name_snapshot, unit_price, quantity, calculated_amount, paid_amount,
                    funding_channel_id, funding_channel_name_snapshot,
                    purchase_channel_id, purchase_channel_name_snapshot,
                    location_label_id, location_label_name_snapshot, note, created_at, updated_at)
                VALUES (current_setting('app.tenant_id')::uuid, :id, 'EXPENSE', :businessTime, :businessDate,
                    :productId, :productName, :primaryId, :primaryName, :secondaryId, :secondaryName,
                    :unitId, :unitName, :unitPrice, :quantity, :calculatedAmount, :paidAmount,
                    :fundingId, :fundingName, :purchaseId, :purchaseName,
                    :locationId, :locationName, :note, :now, :now)
                """).param("id", id).param("businessTime", Timestamp.from(request.occurredAt()))
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
                .param("now", Timestamp.from(now)).update();
    }

    Optional<ExpenseResponse> findExpense(UUID id) {
        return jdbc.sql("""
                SELECT id, business_time, business_date,
                       product_id, product_name_snapshot, primary_category_id, primary_category_name_snapshot,
                       secondary_category_id, secondary_category_name_snapshot, unit_id, unit_name_snapshot,
                       unit_price, quantity, calculated_amount, paid_amount,
                       funding_channel_id, funding_channel_name_snapshot,
                       purchase_channel_id, purchase_channel_name_snapshot,
                       location_label_id, location_label_name_snapshot, note, created_at, updated_at, version
                  FROM ledger_entry
                 WHERE id = :id AND entry_type = 'EXPENSE' AND lifecycle_status = 'ACTIVE'
                """).param("id", id).query(ExpenseRepository::mapExpense).optional();
    }

    /** 版本条件与字段更新在同一语句完成，避免读后写窗口覆盖并发修改。 */
    boolean updateExpense(UUID id, long version, ExpenseContracts.CreateExpenseRequest request,
                          ExpenseReferences references, BigDecimal unitPrice, BigDecimal quantity,
                          BigDecimal paidAmount, BigDecimal calculatedAmount, LocalDate businessDate,
                          String note, Instant now) {
        return jdbc.sql("""
                UPDATE ledger_entry SET business_time=:businessTime,business_date=:businessDate,
                  product_id=:productId,product_name_snapshot=:productName,
                  primary_category_id=:primaryId,primary_category_name_snapshot=:primaryName,
                  secondary_category_id=:secondaryId,secondary_category_name_snapshot=:secondaryName,
                  unit_id=:unitId,unit_name_snapshot=:unitName,unit_price=:unitPrice,quantity=:quantity,
                  calculated_amount=:calculatedAmount,paid_amount=:paidAmount,
                  funding_channel_id=:fundingId,funding_channel_name_snapshot=:fundingName,
                  purchase_channel_id=:purchaseId,purchase_channel_name_snapshot=:purchaseName,
                  location_label_id=:locationId,location_label_name_snapshot=:locationName,
                  note=:note,updated_at=:now,version=version+1
                WHERE id=:id AND entry_type='EXPENSE' AND lifecycle_status='ACTIVE' AND version=:version
                """).param("businessTime", Timestamp.from(request.occurredAt())).param("businessDate", businessDate)
                .param("productId", request.productId()).param("productName", references.product().name())
                .param("primaryId", request.primaryCategoryId()).param("primaryName", references.primaryCategory().name())
                .param("secondaryId", request.secondaryCategoryId()).param("secondaryName", name(references.secondaryCategory()))
                .param("unitId", request.unitId()).param("unitName", references.unit().name())
                .param("unitPrice", unitPrice).param("quantity", quantity).param("calculatedAmount", calculatedAmount)
                .param("paidAmount", paidAmount).param("fundingId", request.fundingChannelId())
                .param("fundingName", references.fundingChannel().name()).param("purchaseId", request.purchaseChannelId())
                .param("purchaseName", name(references.purchaseChannel())).param("locationId", request.locationLabelId())
                .param("locationName", name(references.locationLabel())).param("note", note)
                .param("now", Timestamp.from(now)).param("id", id).param("version", version).update() == 1;
    }

    Optional<UUID> deleteUndoableExpense(UUID id, String idempotencyKey) {
        Optional<UUID> productId = jdbc.sql("""
                SELECT product_id FROM ledger_entry
                 WHERE id = :id AND entry_type = 'EXPENSE' AND lifecycle_status = 'ACTIVE'
                   AND EXISTS (
                       SELECT 1 FROM idempotency_record i
                        WHERE i.operation = :operation AND i.idempotency_key = :key
                          AND i.status = 'SUCCEEDED' AND i.result_reference = :result)
                   FOR UPDATE
                """).param("id", id).param("operation", CREATE_OPERATION).param("key", idempotencyKey)
                .param("result", id.toString()).query(UUID.class).optional();
        if (productId.isEmpty()) return Optional.empty();
        int affected = jdbc.sql("""
                DELETE FROM ledger_entry l
                 WHERE l.id = :id AND l.entry_type = 'EXPENSE' AND l.lifecycle_status = 'ACTIVE'
                   AND NOT EXISTS (SELECT 1 FROM expense_adjustment a WHERE a.original_expense_id = l.id)
                   AND NOT EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.source_record_id = l.id)
                """).param("id", id).update();
        return affected == 1 ? productId : Optional.empty();
    }

    private static String name(com.mybill.dictionary.ExpenseDictionaryService.NamedReference reference) {
        return reference == null ? null : reference.name();
    }

    private static ExpenseResponse mapExpense(ResultSet rs, int rowNumber) throws SQLException {
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
