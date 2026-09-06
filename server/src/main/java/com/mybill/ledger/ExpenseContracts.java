package com.mybill.ledger;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class ExpenseContracts {
    private ExpenseContracts() { }

    record CreateExpenseRequest(
            @NotNull UUID productId,
            @NotNull UUID primaryCategoryId,
            UUID secondaryCategoryId,
            @NotNull UUID unitId,
            @NotBlank String unitPrice,
            @NotBlank String quantity,
            @NotBlank String paidAmount,
            @NotNull UUID fundingChannelId,
            UUID purchaseChannelId,
            UUID locationLabelId,
            @NotNull Instant occurredAt,
            String note
    ) { }

    record ExpenseResponse(
            UUID id,
            Instant occurredAt,
            LocalDate businessDate,
            UUID productId,
            String productName,
            UUID primaryCategoryId,
            String primaryCategoryName,
            UUID secondaryCategoryId,
            String secondaryCategoryName,
            UUID unitId,
            String unitName,
            String unitPrice,
            String quantity,
            String calculatedAmount,
            String paidAmount,
            UUID fundingChannelId,
            String fundingChannelName,
            UUID purchaseChannelId,
            String purchaseChannelName,
            UUID locationLabelId,
            String locationLabelName,
            String note,
            Instant createdAt
    ) { }

    record ProductSuggestion(
            UUID id,
            String name,
            UUID primaryCategoryId,
            String primaryCategoryName,
            UUID secondaryCategoryId,
            String secondaryCategoryName,
            UUID unitId,
            String unitName,
            String lastUnitPrice,
            UUID fundingChannelId,
            String fundingChannelName,
            UUID purchaseChannelId,
            String purchaseChannelName
    ) { }

    record ProductSuggestions(List<ProductSuggestion> items) { }

    record CreationResult(ExpenseResponse response, boolean replayed) { }
}
