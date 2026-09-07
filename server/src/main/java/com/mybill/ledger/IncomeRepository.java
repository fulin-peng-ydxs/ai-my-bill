package com.mybill.ledger;

import com.mybill.dictionary.IncomeDictionaryService.IncomeReferences;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import com.mybill.shared.persistence.DatabaseRow;
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
    private final MybatisOperations operations;
    private final IncomeRepositoryMapper mapper;
    IncomeRepository(MybatisOperations operations, IncomeRepositoryMapper mapper) { this.operations = operations; this.mapper = mapper; }

    void insert(UUID id, IncomeContracts.CreateIncomeRequest request, String incomeName, IncomeReferences refs,
                BigDecimal amount, LocalDate businessDate, String note, Instant now) {
        operations.update(mapper::insert).param("id", id).param("businessTime", Timestamp.from(request.occurredAt()))
                .param("businessDate", businessDate).param("incomeName", incomeName).param("payerId", request.payerId())
                .param("payerName", refs.payer().name()).param("categoryId", request.incomeCategoryId())
                .param("categoryName", refs.category().name()).param("amount", amount)
                .param("fundingId", request.fundingChannelId()).param("fundingName", refs.fundingChannel().name())
                .param("note", note).param("now", Timestamp.from(now)).execute();
    }

    Optional<IncomeResponse> find(UUID id) {
        return operations.select(mapper::find).param("id", id).map(IncomeRepository::map).optional();
    }

    /** 返回 false 表示记录不存在、已非有效状态或版本已变化，由服务层进一步收敛错误语义。 */
    boolean update(UUID id, long version, IncomeContracts.CreateIncomeRequest request, String incomeName,
                   IncomeReferences refs, BigDecimal amount, LocalDate businessDate, String note, Instant now) {
        return operations.update(mapper::update).param("businessTime", Timestamp.from(request.occurredAt())).param("businessDate", businessDate)
                .param("incomeName", incomeName).param("payerId", request.payerId()).param("payerName", refs.payer().name())
                .param("categoryId", request.incomeCategoryId()).param("categoryName", refs.category().name())
                .param("amount", amount).param("fundingId", request.fundingChannelId())
                .param("fundingName", refs.fundingChannel().name()).param("note", note).param("now", Timestamp.from(now))
                .param("id", id).param("version", version).execute() == 1;
    }

    List<String> names(String escapedQuery) {
        return operations.select(mapper::names).param("query", escapedQuery).map(String.class).list();
    }

    boolean deleteUndoable(UUID id, String key) {
        return operations.update(mapper::deleteUndoable).param("id", id).param("key", key).param("result", id.toString()).execute() == 1;
    }

    private static IncomeResponse map(DatabaseRow rs, int row) throws SQLException {
        return new IncomeResponse(rs.getObject("id", UUID.class), rs.getTimestamp("business_time").toInstant(),
                rs.getObject("business_date", LocalDate.class), rs.getString("income_name"),
                rs.getObject("payer_id", UUID.class), rs.getString("payer_name_snapshot"),
                rs.getObject("income_category_id", UUID.class), rs.getString("income_category_name_snapshot"),
                rs.getBigDecimal("income_amount").setScale(2).toPlainString(), rs.getObject("funding_channel_id", UUID.class),
                rs.getString("funding_channel_name_snapshot"), rs.getString("note"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant(), rs.getLong("version"));
    }
}
