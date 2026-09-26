package com.mybill.report;

import java.time.LocalDate;
import java.util.UUID;

record ReportFilter(
        ReportContracts.Scope scope,
        LocalDate startDate,
        LocalDate endDate,
        String keyword,
        UUID fundingChannelId,
        UUID primaryCategoryId,
        UUID secondaryCategoryId,
        UUID productId,
        UUID purchaseChannelId,
        UUID locationLabelId,
        UUID incomeCategoryId,
        UUID payerId,
        String incomeName
) { }
