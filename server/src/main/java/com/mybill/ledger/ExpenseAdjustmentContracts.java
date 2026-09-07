package com.mybill.ledger;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

final class ExpenseAdjustmentContracts {
    private ExpenseAdjustmentContracts() { }

    enum AdjustmentType { REFUND, REIMBURSEMENT }

    record CreateAdjustmentRequest(
            @NotNull AdjustmentType adjustmentType,
            @NotBlank String amount,
            @NotNull Instant occurredAt,
            String note
    ) { }

    record RevokeAdjustmentRequest(@NotNull @PositiveOrZero Long version) { }

    record AdjustmentResponse(
            UUID id,
            UUID originalExpenseId,
            String originalExpenseTitle,
            AdjustmentType adjustmentType,
            String amount,
            Instant occurredAt,
            LocalDate businessDate,
            String status,
            String note,
            String originalPaidAmount,
            String effectiveAdjustmentAmount,
            String netExpenseAmount,
            boolean fullyAdjusted,
            Instant createdAt,
            Instant updatedAt,
            long version
    ) { }

    record CreationResult(AdjustmentResponse response, boolean replayed) { }
}
