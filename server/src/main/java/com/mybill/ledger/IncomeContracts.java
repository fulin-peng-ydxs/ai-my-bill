package com.mybill.ledger;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.Valid;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class IncomeContracts {
    private IncomeContracts() { }
    record CreateIncomeRequest(@NotBlank String incomeName, @NotNull UUID payerId,
            @NotNull UUID incomeCategoryId, @NotBlank String amount, @NotNull UUID fundingChannelId,
            @NotNull Instant occurredAt, String note) { }
    /** 编辑与新增共用字段校验，只增加预期版本。 */
    record UpdateIncomeRequest(@NotNull @PositiveOrZero Long version,
            @NotNull @Valid CreateIncomeRequest entry) { }
    record IncomeResponse(UUID id, Instant occurredAt, LocalDate businessDate, String incomeName,
            UUID payerId, String payerName, UUID incomeCategoryId, String incomeCategoryName,
            String amount, UUID fundingChannelId, String fundingChannelName, String note, Instant createdAt,
            Instant updatedAt, long version) { }
    record IncomeNames(List<String> items) { }
    record CreationResult(IncomeResponse response, boolean replayed) { }
}
