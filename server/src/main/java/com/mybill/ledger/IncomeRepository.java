package com.mybill.ledger;

import com.mybill.dictionary.IncomeDictionaryService.IncomeReferences;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static com.mybill.ledger.IncomeContracts.IncomeResponse;

@Repository
class IncomeRepository {
    private final JdbcClient jdbc;
    IncomeRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    void insert(UUID id, IncomeContracts.CreateIncomeRequest request, String incomeName, IncomeReferences refs,
                BigDecimal amount, LocalDate businessDate, String note, Instant now) {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,
                  payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,income_amount,
                  funding_channel_id,funding_channel_name_snapshot,note,created_at,updated_at)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME',:businessTime,:businessDate,:incomeName,
                  :payerId,:payerName,:categoryId,:categoryName,:amount,:fundingId,:fundingName,:note,:now,:now)
                """).param("id", id).param("businessTime", Timestamp.from(request.occurredAt()))
                .param("businessDate", businessDate).param("incomeName", incomeName).param("payerId", request.payerId())
                .param("payerName", refs.payer().name()).param("categoryId", request.incomeCategoryId())
                .param("categoryName", refs.category().name()).param("amount", amount)
                .param("fundingId", request.fundingChannelId()).param("fundingName", refs.fundingChannel().name())
                .param("note", note).param("now", Timestamp.from(now)).update();
    }

    Optional<IncomeResponse> find(UUID id) {
        return jdbc.sql("""
                SELECT id,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,
                  funding_channel_name_snapshot,note,created_at,updated_at,version FROM ledger_entry
                 WHERE id=:id AND entry_type='INCOME' AND lifecycle_status='ACTIVE'
                """).param("id", id).query(IncomeRepository::map).optional();
    }

    /** 返回 false 表示记录不存在、已非有效状态或版本已变化，由服务层进一步收敛错误语义。 */
    boolean update(UUID id, long version, IncomeContracts.CreateIncomeRequest request, String incomeName,
                   IncomeReferences refs, BigDecimal amount, LocalDate businessDate, String note, Instant now) {
        return jdbc.sql("""
                UPDATE ledger_entry SET business_time=:businessTime,business_date=:businessDate,income_name=:incomeName,
                  payer_id=:payerId,payer_name_snapshot=:payerName,income_category_id=:categoryId,
                  income_category_name_snapshot=:categoryName,income_amount=:amount,funding_channel_id=:fundingId,
                  funding_channel_name_snapshot=:fundingName,note=:note,updated_at=:now,version=version+1
                WHERE id=:id AND entry_type='INCOME' AND lifecycle_status='ACTIVE' AND version=:version
                """).param("businessTime", Timestamp.from(request.occurredAt())).param("businessDate", businessDate)
                .param("incomeName", incomeName).param("payerId", request.payerId()).param("payerName", refs.payer().name())
                .param("categoryId", request.incomeCategoryId()).param("categoryName", refs.category().name())
                .param("amount", amount).param("fundingId", request.fundingChannelId())
                .param("fundingName", refs.fundingChannel().name()).param("note", note).param("now", Timestamp.from(now))
                .param("id", id).param("version", version).update() == 1;
    }

    List<String> names(String escapedQuery) {
        return jdbc.sql("""
                SELECT income_name FROM ledger_entry WHERE entry_type='INCOME' AND lifecycle_status='ACTIVE'
                  AND (:query='' OR lower(income_name) LIKE ('%' || lower(:query) || '%') ESCAPE '\\')
                GROUP BY income_name ORDER BY max(updated_at) DESC, income_name LIMIT 20
                """).param("query", escapedQuery).query(String.class).list();
    }

    boolean deleteUndoable(UUID id, String key) {
        return jdbc.sql("""
                DELETE FROM ledger_entry l WHERE l.id=:id AND l.entry_type='INCOME' AND l.lifecycle_status='ACTIVE'
                 AND EXISTS (SELECT 1 FROM idempotency_record i WHERE i.operation='CREATE_INCOME'
                   AND i.idempotency_key=:key AND i.status='SUCCEEDED' AND i.result_reference=:result)
                 AND NOT EXISTS (SELECT 1 FROM daily_entry_template t WHERE t.source_record_id=l.id)
                """).param("id", id).param("key", key).param("result", id.toString()).update() == 1;
    }

    private static IncomeResponse map(ResultSet rs, int row) throws SQLException {
        return new IncomeResponse(rs.getObject("id", UUID.class), rs.getTimestamp("business_time").toInstant(),
                rs.getObject("business_date", LocalDate.class), rs.getString("income_name"),
                rs.getObject("payer_id", UUID.class), rs.getString("payer_name_snapshot"),
                rs.getObject("income_category_id", UUID.class), rs.getString("income_category_name_snapshot"),
                rs.getBigDecimal("income_amount").setScale(2).toPlainString(), rs.getObject("funding_channel_id", UUID.class),
                rs.getString("funding_channel_name_snapshot"), rs.getString("note"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant(), rs.getLong("version"));
    }
}
