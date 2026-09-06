package com.mybill.preference;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
class PreferenceRepository {
    private final JdbcClient jdbc;

    PreferenceRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Optional<PreferenceRow> find(UUID userId) {
        return jdbc.sql("""
                SELECT p.default_funding_channel_id, f.display_name AS funding_channel_name,
                       p.ledger_default_range, p.report_default_range,
                       p.theme_mode, p.recent_entry_type, p.updated_at,
                       COALESCE(f.status = 'ACTIVE', false) AS funding_channel_active
                FROM user_preference p
                LEFT JOIN funding_channel f
                  ON f.tenant_id = p.tenant_id AND f.id = p.default_funding_channel_id
                WHERE p.user_id = :userId
                """).param("userId", userId).query(PreferenceRepository::mapRow).optional();
    }

    boolean isActiveFundingChannel(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM funding_channel WHERE id = :id AND status = 'ACTIVE')")
                .param("id", id).query(Boolean.class).single();
    }

    int upsert(UUID userId, UUID fundingChannelId, String ledgerRange, String reportRange,
               String themeMode, String entryType, Instant now) {
        return jdbc.sql("""
                INSERT INTO user_preference(
                    tenant_id, user_id, default_funding_channel_id, ledger_default_range,
                    report_default_range, theme_mode, recent_entry_type, created_at, updated_at
                ) VALUES (
                    current_setting('app.tenant_id')::uuid, :userId, :fundingChannelId, :ledgerRange,
                    :reportRange, :themeMode, :entryType, :now, :now
                )
                ON CONFLICT (tenant_id, user_id) DO UPDATE SET
                    default_funding_channel_id = EXCLUDED.default_funding_channel_id,
                    ledger_default_range = EXCLUDED.ledger_default_range,
                    report_default_range = EXCLUDED.report_default_range,
                    theme_mode = EXCLUDED.theme_mode,
                    recent_entry_type = EXCLUDED.recent_entry_type,
                    updated_at = EXCLUDED.updated_at
                """)
                .param("userId", userId).param("fundingChannelId", fundingChannelId)
                .param("ledgerRange", ledgerRange).param("reportRange", reportRange)
                .param("themeMode", themeMode).param("entryType", entryType)
                .param("now", Timestamp.from(now)).update();
    }

    int delete(UUID userId) {
        return jdbc.sql("DELETE FROM user_preference WHERE user_id = :userId")
                .param("userId", userId).update();
    }

    private static PreferenceRow mapRow(ResultSet rs, int rowNumber) throws SQLException {
        return new PreferenceRow(
                rs.getObject("default_funding_channel_id", UUID.class),
                rs.getString("funding_channel_name"),
                rs.getString("ledger_default_range"), rs.getString("report_default_range"),
                rs.getString("theme_mode"), rs.getString("recent_entry_type"),
                rs.getTimestamp("updated_at").toInstant(), rs.getBoolean("funding_channel_active")
        );
    }

    record PreferenceRow(UUID fundingChannelId, String fundingChannelName, String ledgerRange, String reportRange,
                         String themeMode, String entryType, Instant updatedAt, boolean fundingChannelActive) { }
}
