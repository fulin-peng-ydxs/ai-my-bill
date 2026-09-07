package com.mybill.preference;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import com.mybill.shared.persistence.DatabaseRow;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
class PreferenceRepository {
    private final MybatisOperations operations;
    private final PreferenceRepositoryMapper mapper;

    PreferenceRepository(MybatisOperations operations, PreferenceRepositoryMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    Optional<PreferenceRow> find(UUID userId) {
        return operations.select(mapper::find).param("userId", userId).map(PreferenceRepository::mapRow).optional();
    }

    boolean isActiveFundingChannel(UUID id) {
        return operations.select(mapper::isActiveFundingChannel)
                .param("id", id).map(Boolean.class).single();
    }

    int upsert(UUID userId, UUID fundingChannelId, String ledgerRange, String reportRange,
               String themeMode, String entryType, Instant now) {
        return operations.update(mapper::upsert)
                .param("userId", userId).param("fundingChannelId", fundingChannelId)
                .param("ledgerRange", ledgerRange).param("reportRange", reportRange)
                .param("themeMode", themeMode).param("entryType", entryType)
                .param("now", Timestamp.from(now)).execute();
    }

    int delete(UUID userId) {
        return operations.update(mapper::delete)
                .param("userId", userId).execute();
    }

    private static PreferenceRow mapRow(DatabaseRow rs, int rowNumber) throws SQLException {
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
