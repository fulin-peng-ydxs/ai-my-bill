package com.mybill.ledger;

import com.mybill.shared.time.BusinessDateRange;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

final class ExportContracts {
    private ExportContracts() { }

    enum ExportScope { CURRENT_FILTERS, ALL_DATA }

    record CreateExportRequest(
            @NotNull ExportScope scope,
            LedgerQueryContracts.EntryTypeFilter type,
            LedgerQueryContracts.LifecycleFilter lifecycle,
            UUID fundingChannelId,
            BusinessDateRange range,
            LocalDate startDate,
            LocalDate endDate,
            @Size(max = 200) String query
    ) { }

    record ExportResponse(UUID id, String scope, String status, long rowCount,
                          Instant createdAt, Instant expiresAt, String errorMessage,
                          String downloadUrl) { }

    record ExportSnapshot(ExportScope scope, LedgerQueryContracts.EntryTypeFilter type,
                          LedgerQueryContracts.LifecycleFilter lifecycle, UUID fundingChannelId,
                          LocalDate startDate, LocalDate endDate, String query) { }
}
