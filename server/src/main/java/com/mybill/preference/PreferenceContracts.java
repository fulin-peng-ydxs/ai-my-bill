package com.mybill.preference;

import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.UUID;

final class PreferenceContracts {
    private PreferenceContracts() { }

    enum LedgerRange { TODAY, THIS_WEEK, THIS_MONTH }
    enum ReportRange { THIS_WEEK, THIS_MONTH, LAST_MONTH, THIS_YEAR }
    enum ThemeMode { SYSTEM, LIGHT, DARK }
    enum EntryType { EXPENSE, INCOME }

    record PreferenceRequest(
            UUID defaultFundingChannelId,
            @NotNull LedgerRange ledgerDefaultRange,
            @NotNull ReportRange reportDefaultRange,
            @NotNull ThemeMode themeMode,
            @NotNull EntryType recentEntryType
    ) { }

    record PreferenceResponse(
            UUID defaultFundingChannelId,
            String defaultFundingChannelName,
            LedgerRange ledgerDefaultRange,
            ReportRange reportDefaultRange,
            ThemeMode themeMode,
            EntryType recentEntryType,
            Instant updatedAt
    ) { }
}
