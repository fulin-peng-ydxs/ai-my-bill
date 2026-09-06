package com.mybill.ledger;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

final class DailyTemplateContracts {
    private DailyTemplateContracts() { }

    enum EntryType { EXPENSE, INCOME }

    record TemplateSummary(UUID id, EntryType entryType, String displayName, String amount,
                           String contextName, Instant lastUsedAt) { }
    record TemplateList(List<TemplateSummary> items) { }

    /** 选择结果只携带账目表单白名单；失效引用以 null 回退并通过 unavailableFields 明示。 */
    record TemplateSelection(
            UUID id, EntryType entryType, String displayName,
            UUID productId, String productName, UUID primaryCategoryId, String primaryCategoryName,
            UUID secondaryCategoryId, String secondaryCategoryName, UUID unitId, String unitName,
            String unitPrice, String quantity, String paidAmount,
            UUID fundingChannelId, String fundingChannelName,
            UUID purchaseChannelId, String purchaseChannelName,
            UUID locationLabelId, String locationLabelName,
            String incomeName, UUID payerId, String payerName,
            UUID incomeCategoryId, String incomeCategoryName, String incomeAmount,
            List<String> unavailableFields
    ) { }
}
