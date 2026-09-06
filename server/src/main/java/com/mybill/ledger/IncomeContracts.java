package com.mybill.ledger;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class IncomeContracts {
    private IncomeContracts() { }
    record CreateIncomeRequest(@NotBlank String incomeName, @NotNull UUID payerId,
            @NotNull UUID incomeCategoryId, @NotBlank String amount, @NotNull UUID fundingChannelId,
            @NotNull Instant occurredAt, String note) { }
    record IncomeResponse(UUID id, Instant occurredAt, LocalDate businessDate, String incomeName,
            UUID payerId, String payerName, UUID incomeCategoryId, String incomeCategoryName,
            String amount, UUID fundingChannelId, String fundingChannelName, String note, Instant createdAt) { }
    record IncomeNames(List<String> items) { }
    record CreationResult(IncomeResponse response, boolean replayed) { }
}
