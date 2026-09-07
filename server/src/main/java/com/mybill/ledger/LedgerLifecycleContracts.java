package com.mybill.ledger;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;
import java.util.UUID;

final class LedgerLifecycleContracts {
    private LedgerLifecycleContracts() { }

    record LifecycleRequest(@NotNull @PositiveOrZero Long version) { }

    record LifecycleResponse(
            UUID id,
            String entryType,
            String lifecycleStatus,
            Instant deletedAt,
            Instant purgeAfter,
            long version,
            int linkedAdjustmentCount
    ) { }
}
