package com.mybill.ledger;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class LedgerQueryContracts {
    private LedgerQueryContracts() { }

    enum EntryTypeFilter { ALL, EXPENSE, INCOME, ADJUSTMENT, EXPENSE_FLOW }
    enum LifecycleFilter { ACTIVE, TRASHED }
    record LedgerItem(
            UUID id, String entryType, Instant occurredAt, LocalDate businessDate,
            String title, String categoryName, String counterpartyName, String fundingChannelName,
            String amount, String note, Instant createdAt,
            String adjustmentType, UUID originalExpenseId,
            String effectiveAdjustmentAmount, String netExpenseAmount, boolean fullyAdjusted,
            long version, String lifecycleStatus, Instant deletedAt, Instant purgeAfter,
            Integer remainingDays, int linkedAdjustmentCount
    ) { }

    record LedgerPage(List<LedgerItem> items, String nextCursor, boolean hasMore) { }
}
