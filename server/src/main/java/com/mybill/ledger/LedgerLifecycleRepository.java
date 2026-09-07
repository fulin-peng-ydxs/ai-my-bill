package com.mybill.ledger;

import com.mybill.ledger.LedgerLifecycleContracts.LifecycleResponse;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 账目与调整生命周期仓储；调用方必须处于已设置租户 RLS 上下文的事务中。 */
@Repository
class LedgerLifecycleRepository {
    private final JdbcClient jdbc;

    LedgerLifecycleRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    Optional<LifecycleResponse> findLedger(UUID id) {
        return jdbc.sql("""
                SELECT l.id,l.entry_type,l.lifecycle_status,l.deleted_at,l.purge_after,l.version,
                       (SELECT count(*) FROM expense_adjustment a WHERE a.original_expense_id=l.id) AS linked_count
                  FROM ledger_entry l WHERE l.id=:id
                """).param("id", id).query(LedgerLifecycleRepository::mapLedger).optional();
    }

    Optional<LifecycleResponse> findAdjustment(UUID id) {
        return jdbc.sql("""
                SELECT a.id,'ADJUSTMENT' AS entry_type,a.status AS lifecycle_status,a.deleted_at,a.purge_after,a.version,
                       0 AS linked_count
                  FROM expense_adjustment a WHERE a.id=:id
                """).param("id", id).query(LedgerLifecycleRepository::mapLedger).optional();
    }

    boolean trashLedger(UUID id, long version, Instant now) {
        return jdbc.sql("""
                UPDATE ledger_entry SET lifecycle_status='TRASHED',deleted_at=:now,
                       purge_after=:purgeAfter,updated_at=:now,version=version+1
                 WHERE id=:id AND lifecycle_status='ACTIVE' AND version=:version
                """).param("id", id).param("version", version).param("now", Timestamp.from(now))
                .param("purgeAfter", Timestamp.from(now.plusSeconds(30L * 86400))).update() == 1;
    }

    boolean restoreLedger(UUID id, long version, Instant now) {
        return jdbc.sql("""
                UPDATE ledger_entry SET lifecycle_status='ACTIVE',deleted_at=NULL,purge_after=NULL,
                       updated_at=:now,version=version+1
                 WHERE id=:id AND lifecycle_status='TRASHED' AND purge_after>:now AND version=:version
                """).param("id", id).param("version", version).param("now", Timestamp.from(now)).update() == 1;
    }

    boolean trashAdjustment(UUID id, long version, Instant now) {
        return jdbc.sql("""
                UPDATE expense_adjustment SET status='TRASHED',deleted_at=:now,
                       purge_after=:purgeAfter,updated_at=:now,version=version+1
                 WHERE id=:id AND status='EFFECTIVE' AND version=:version
                """).param("id", id).param("version", version).param("now", Timestamp.from(now))
                .param("purgeAfter", Timestamp.from(now.plusSeconds(30L * 86400))).update() == 1;
    }

    boolean restoreAdjustment(UUID id, long version, Instant now) {
        Optional<AdjustmentRestoreState> state = jdbc.sql("""
                SELECT a.amount,l.paid_amount
                  FROM expense_adjustment a JOIN ledger_entry l ON l.id=a.original_expense_id
                 WHERE a.id=:id AND a.status='TRASHED' AND a.purge_after>:now AND a.version=:version
                   AND l.entry_type='EXPENSE' AND l.lifecycle_status='ACTIVE'
                 FOR UPDATE OF a,l
                """).param("id", id).param("version", version).param("now", Timestamp.from(now))
                .query((rs, row) -> new AdjustmentRestoreState(rs.getBigDecimal("amount"), rs.getBigDecimal("paid_amount")))
                .optional();
        if (state.isEmpty()) return false;
        BigDecimal effective = jdbc.sql("""
                SELECT COALESCE(sum(active.amount),0) FROM expense_adjustment active
                 WHERE active.original_expense_id=(SELECT original_expense_id FROM expense_adjustment WHERE id=:id)
                   AND active.status='EFFECTIVE'
                """).param("id", id).query(BigDecimal.class).single();
        if (effective.add(state.get().amount()).compareTo(state.get().paidAmount()) > 0) return false;
        return jdbc.sql("""
                UPDATE expense_adjustment a SET status='EFFECTIVE',deleted_at=NULL,purge_after=NULL,
                       updated_at=:now,version=version+1
                 WHERE a.id=:id AND a.status='TRASHED' AND a.purge_after>:now AND a.version=:version
                   AND EXISTS (SELECT 1 FROM ledger_entry l WHERE l.id=a.original_expense_id
                               AND l.entry_type='EXPENSE' AND l.lifecycle_status='ACTIVE')
                """).param("id", id).param("version", version).param("now", Timestamp.from(now)).update() == 1;
    }

    boolean purgeLedger(UUID id, long version) {
        Optional<UUID> locked = jdbc.sql("""
                SELECT id FROM ledger_entry WHERE id=:id AND lifecycle_status='TRASHED' AND version=:version FOR UPDATE
                """).param("id", id).param("version", version).query(UUID.class).optional();
        if (locked.isEmpty()) return false;
        jdbc.sql("DELETE FROM expense_adjustment WHERE original_expense_id=:id").param("id", id).update();
        return jdbc.sql("DELETE FROM ledger_entry WHERE id=:id AND lifecycle_status='TRASHED' AND version=:version")
                .param("id", id).param("version", version).update() == 1;
    }

    boolean purgeAdjustment(UUID id, long version) {
        return jdbc.sql("DELETE FROM expense_adjustment WHERE id=:id AND status='TRASHED' AND version=:version")
                .param("id", id).param("version", version).update() == 1;
    }

    private static LifecycleResponse mapLedger(ResultSet rs, int row) throws SQLException {
        Timestamp deleted = rs.getTimestamp("deleted_at");
        Timestamp purge = rs.getTimestamp("purge_after");
        return new LifecycleResponse(rs.getObject("id", UUID.class), rs.getString("entry_type"),
                rs.getString("lifecycle_status"), deleted == null ? null : deleted.toInstant(),
                purge == null ? null : purge.toInstant(), rs.getLong("version"), rs.getInt("linked_count"));
    }

    private record AdjustmentRestoreState(BigDecimal amount, BigDecimal paidAmount) { }
}
