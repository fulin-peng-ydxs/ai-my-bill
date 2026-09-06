package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.dictionary.DictionaryNameNormalizer;
import com.mybill.ledger.DailyTemplateContracts.*;
import com.mybill.ledger.DailyTemplateRepository.SourceRow;
import com.mybill.ledger.DailyTemplateRepository.TemplateRow;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static com.mybill.ledger.LedgerWritePolicy.decimal;

@Service
class DailyTemplateService {
    private final DailyTemplateRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    DailyTemplateService(DailyTemplateRepository repository, TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository; this.tenantTransactions = tenantTransactions; this.clock = clock;
    }

    TemplateList list(CurrentPrincipal principal, EntryType type) {
        return tenantTransactions.execute(principal, () -> new TemplateList(repository.list(type)));
    }

    TemplateSummary upsertFromLedger(CurrentPrincipal principal, UUID ledgerId) {
        Instant now = clock.instant();
        return tenantTransactions.execute(principal, () -> {
            SourceRow source = repository.lockActiveSource(ledgerId).orElseThrow(() -> notFound("有效收支不存在。"));
            validateSource(source);
            String display = source.entryType() == EntryType.EXPENSE ? source.currentProductName() : source.incomeName();
            String normalized = source.entryType() == EntryType.EXPENSE ? source.currentProductNormalized()
                    : DictionaryNameNormalizer.normalizedName(source.incomeName());
            if (display == null || display.isBlank() || normalized.isBlank()) throw invalidSource("来源名称无效。", List.of("displayName"));
            return repository.upsert(source, display, normalized, now);
        });
    }

    TemplateSelection select(CurrentPrincipal principal, UUID id) {
        Instant now = clock.instant();
        return tenantTransactions.execute(principal, () -> {
            TemplateRow row = repository.lockTemplate(id).orElseThrow(() -> notFound("日常模板不存在。"));
            List<String> unavailable = unavailableFields(row);
            repository.touch(id, now);
            boolean expense = row.entryType() == EntryType.EXPENSE;
            boolean primary = expense && row.primaryActive();
            return new TemplateSelection(row.id(), row.entryType(), row.displayName(),
                    activeId(expense && row.productActive(), row.productId()), activeName(expense && row.productActive(), row.productName()),
                    activeId(primary, row.primaryCategoryId()), activeName(primary, row.primaryCategoryName()),
                    activeId(primary && row.secondaryCategoryId() != null && row.secondaryActive(), row.secondaryCategoryId()),
                    activeName(primary && row.secondaryCategoryId() != null && row.secondaryActive(), row.secondaryCategoryName()),
                    activeId(expense && row.unitActive(), row.unitId()), activeName(expense && row.unitActive(), row.unitName()),
                    expense ? decimal(row.unitPrice()) : null, expense ? decimal(row.quantity()) : null,
                    expense ? row.paidAmount().setScale(2).toPlainString() : null,
                    activeId(row.fundingActive(), row.fundingChannelId()), activeName(row.fundingActive(), row.fundingChannelName()),
                    activeId(expense && row.purchaseChannelId() != null && row.purchaseActive(), row.purchaseChannelId()),
                    activeName(expense && row.purchaseChannelId() != null && row.purchaseActive(), row.purchaseChannelName()),
                    activeId(expense && row.locationLabelId() != null && row.locationActive(), row.locationLabelId()),
                    activeName(expense && row.locationLabelId() != null && row.locationActive(), row.locationLabelName()),
                    expense ? null : row.incomeName(), activeId(!expense && row.payerActive(), row.payerId()),
                    activeName(!expense && row.payerActive(), row.payerName()),
                    activeId(!expense && row.incomeCategoryActive(), row.incomeCategoryId()),
                    activeName(!expense && row.incomeCategoryActive(), row.incomeCategoryName()),
                    expense ? null : row.incomeAmount().setScale(2).toPlainString(), List.copyOf(unavailable));
        });
    }

    void remove(CurrentPrincipal principal, UUID id) {
        tenantTransactions.execute(principal, () -> {
            if (!repository.delete(id)) throw notFound("日常模板不存在。");
            return null;
        });
    }

    private void validateSource(SourceRow row) {
        List<String> invalid = new ArrayList<>();
        if (!row.fundingActive()) invalid.add("fundingChannelId");
        if (row.entryType() == EntryType.EXPENSE) {
            if (!row.productActive()) invalid.add("productId");
            if (!row.primaryActive()) invalid.add("primaryCategoryId");
            if (row.secondaryCategoryId() != null && !row.secondaryActive()) invalid.add("secondaryCategoryId");
            if (!row.unitActive()) invalid.add("unitId");
            if (row.purchaseChannelId() != null && !row.purchaseActive()) invalid.add("purchaseChannelId");
            if (row.locationLabelId() != null && !row.locationActive()) invalid.add("locationLabelId");
        } else {
            if (!row.payerActive()) invalid.add("payerId");
            if (!row.incomeCategoryActive()) invalid.add("incomeCategoryId");
        }
        if (!invalid.isEmpty()) throw invalidSource("来源包含已停用或失效字段，不能加入日常。", invalid);
    }

    private List<String> unavailableFields(TemplateRow row) {
        List<String> fields = new ArrayList<>();
        if (!row.fundingActive()) fields.add("fundingChannelId");
        if (row.entryType() == EntryType.EXPENSE) {
            if (!row.productActive()) fields.add("productId");
            if (!row.primaryActive()) fields.add("primaryCategoryId");
            if (row.secondaryCategoryId() != null && (!row.primaryActive() || !row.secondaryActive())) fields.add("secondaryCategoryId");
            if (!row.unitActive()) fields.add("unitId");
            if (row.purchaseChannelId() != null && !row.purchaseActive()) fields.add("purchaseChannelId");
            if (row.locationLabelId() != null && !row.locationActive()) fields.add("locationLabelId");
        } else {
            if (!row.payerActive()) fields.add("payerId");
            if (!row.incomeCategoryActive()) fields.add("incomeCategoryId");
        }
        return fields;
    }

    private static UUID activeId(boolean active, UUID value) { return active ? value : null; }
    private static String activeName(boolean active, String value) { return active ? value : null; }
    private static ApiException notFound(String message) { return new ApiException(HttpStatus.NOT_FOUND, "DAILY_TEMPLATE_NOT_FOUND", message, false); }
    private static ApiException invalidSource(String message, List<String> fields) {
        return new ApiException(HttpStatus.CONFLICT, "DAILY_TEMPLATE_SOURCE_INVALID", message, false,
                java.util.Map.of("source", fields));
    }
}
