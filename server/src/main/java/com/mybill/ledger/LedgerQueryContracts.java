package com.mybill.ledger;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class LedgerQueryContracts {
    private LedgerQueryContracts() { }

    enum EntryTypeFilter { ALL, EXPENSE, INCOME, ADJUSTMENT }
    enum DateRange { TODAY, THIS_WEEK, THIS_MONTH, LAST_MONTH, THIS_YEAR, CUSTOM }

    record LedgerItem(
            UUID id, String entryType, Instant occurredAt, LocalDate businessDate,
            String title, String categoryName, String counterpartyName, String fundingChannelName,
            String amount, String note, Instant createdAt,
            String adjustmentType, UUID originalExpenseId,
            String effectiveAdjustmentAmount, String netExpenseAmount, boolean fullyAdjusted
    ) { }

    record LedgerPage(List<LedgerItem> items, String nextCursor, boolean hasMore) { }
}
