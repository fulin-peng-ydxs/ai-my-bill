package com.mybill.ledger;

import com.mybill.ledger.LedgerLifecycleContracts.LifecycleResponse;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 账目与调整生命周期仓储；调用方必须处于已设置租户 RLS 上下文的事务中。 */
@Repository
class LedgerLifecycleRepository {
    private final MybatisOperations operations;
    private final LedgerLifecycleRepositoryMapper mapper;

    LedgerLifecycleRepository(MybatisOperations operations, LedgerLifecycleRepositoryMapper mapper) { this.operations = operations; this.mapper = mapper; }

    Optional<LifecycleResponse> findLedger(UUID id) {
        return operations.select(mapper::findLedger).param("id", id).map(LedgerLifecycleRepository::mapLedger).optional();
    }

    Optional<LifecycleResponse> findAdjustment(UUID id) {
        return operations.select(mapper::findAdjustment).param("id", id).map(LedgerLifecycleRepository::mapLedger).optional();
    }

    boolean trashLedger(UUID id, long version, Instant now) {
        return operations.update(mapper::trashLedger).param("id", id).param("version", version).param("now", Timestamp.from(now))
                .param("purgeAfter", Timestamp.from(now.plusSeconds(30L * 86400))).execute() == 1;
    }

    boolean restoreLedger(UUID id, long version, Instant now) {
        return operations.update(mapper::restoreLedger).param("id", id).param("version", version).param("now", Timestamp.from(now)).execute() == 1;
    }

    boolean trashAdjustment(UUID id, long version, Instant now) {
        return operations.update(mapper::trashAdjustment).param("id", id).param("version", version).param("now", Timestamp.from(now))
                .param("purgeAfter", Timestamp.from(now.plusSeconds(30L * 86400))).execute() == 1;
    }

    boolean restoreAdjustment(UUID id, long version, Instant now) {
        Optional<AdjustmentRestoreState> state = operations.select(mapper::restoreAdjustment).param("id", id).param("version", version).param("now", Timestamp.from(now))
                .map((rs, row) -> new AdjustmentRestoreState(rs.getBigDecimal("amount"), rs.getBigDecimal("paid_amount")))
                .optional();
        if (state.isEmpty()) return false;
        BigDecimal effective = operations.select(mapper::effectiveAdjustmentTotal).param("id", id).map(BigDecimal.class).single();
        if (effective.add(state.get().amount()).compareTo(state.get().paidAmount()) > 0) return false;
        return operations.update(mapper::reactivateAdjustment).param("id", id).param("version", version).param("now", Timestamp.from(now)).execute() == 1;
    }

    boolean purgeLedger(UUID id, long version) {
        Optional<UUID> locked = operations.select(mapper::purgeLedger).param("id", id).param("version", version).map(UUID.class).optional();
        if (locked.isEmpty()) return false;
        operations.update(mapper::deleteLedgerAdjustments).param("id", id).execute();
        return operations.update(mapper::deleteLedger)
                .param("id", id).param("version", version).execute() == 1;
    }

    boolean purgeAdjustment(UUID id, long version) {
        return operations.update(mapper::purgeAdjustment)
                .param("id", id).param("version", version).execute() == 1;
    }

    private static LifecycleResponse mapLedger(DatabaseRow rs, int row) throws SQLException {
        Timestamp deleted = rs.getTimestamp("deleted_at");
        Timestamp purge = rs.getTimestamp("purge_after");
        return new LifecycleResponse(rs.getObject("id", UUID.class), rs.getString("entry_type"),
                rs.getString("lifecycle_status"), deleted == null ? null : deleted.toInstant(),
                purge == null ? null : purge.toInstant(), rs.getLong("version"), rs.getInt("linked_count"));
    }

    private record AdjustmentRestoreState(BigDecimal amount, BigDecimal paidAmount) { }
}
