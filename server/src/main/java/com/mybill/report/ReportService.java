package com.mybill.report;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.shared.api.ApiException;
import com.mybill.shared.time.BusinessDateRange;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
final class ReportService {
    private final ReportRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    ReportService(ReportRepository repository, TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository;
        this.tenantTransactions = tenantTransactions;
        this.clock = clock;
    }

    ReportContracts.Summary summary(CurrentPrincipal principal, ReportContracts.Scope scope,
                                    BusinessDateRange range, LocalDate customStart, LocalDate customEnd,
                                    String query, UUID fundingChannelId,
                                    UUID primaryCategoryId, UUID secondaryCategoryId, UUID productId,
                                    UUID purchaseChannelId, UUID locationLabelId,
                                    UUID incomeCategoryId, UUID payerId, String incomeName) {
        validateScope(scope, primaryCategoryId, secondaryCategoryId, productId, purchaseChannelId,
                locationLabelId, incomeCategoryId, payerId, incomeName);
        BusinessDateRange.Bounds bounds;
        try {
            bounds = range.resolve(clock, customStart, customEnd);
        } catch (IllegalArgumentException invalid) {
            throw fieldError("startDate", "指定日期必须完整，且结束日期不能早于开始日期。");
        }
        String normalizedQuery = query == null ? "" : query.strip();
        String normalizedIncomeName = incomeName == null || incomeName.isBlank() ? null : incomeName.strip();
        ReportFilter filter = new ReportFilter(scope, bounds.start(), bounds.end(), normalizedQuery,
                fundingChannelId, primaryCategoryId, secondaryCategoryId, productId,
                purchaseChannelId, locationLabelId, incomeCategoryId, payerId, normalizedIncomeName);
        return tenantTransactions.execute(principal, () -> response(scope, repository.summary(filter)));
    }

    private static ReportContracts.Summary response(ReportContracts.Scope scope, ReportRepository.Totals totals) {
        BigDecimal income = totals.totalIncome();
        BigDecimal grossExpense = totals.grossExpense();
        BigDecimal adjustments = totals.adjustmentAmount();
        BigDecimal netExpense = grossExpense.subtract(adjustments);
        BigDecimal balance = income.subtract(netExpense);
        List<ReportContracts.DataPoint> points = new ArrayList<>();
        if (scope != ReportContracts.Scope.EXPENSE) {
            points.add(new ReportContracts.DataPoint("总收入", "INCOME", money(income), totals.incomeCount()));
        }
        if (scope != ReportContracts.Scope.INCOME) {
            points.add(new ReportContracts.DataPoint("原始支出", "EXPENSE", money(grossExpense), totals.expenseCount()));
            points.add(new ReportContracts.DataPoint("退款/报销冲减", "ADJUSTMENT", money(adjustments), totals.adjustmentCount()));
        }
        return new ReportContracts.Summary(money(income), money(grossExpense), money(adjustments),
                money(netExpense), money(balance),
                totals.incomeCount() + totals.expenseCount() + totals.adjustmentCount(), List.copyOf(points));
    }

    private static void validateScope(ReportContracts.Scope scope,
                                      UUID primaryCategoryId, UUID secondaryCategoryId, UUID productId,
                                      UUID purchaseChannelId, UUID locationLabelId,
                                      UUID incomeCategoryId, UUID payerId, String incomeName) {
        boolean expenseSpecific = primaryCategoryId != null || secondaryCategoryId != null || productId != null
                || purchaseChannelId != null || locationLabelId != null;
        boolean incomeSpecific = incomeCategoryId != null || payerId != null
                || incomeName != null && !incomeName.isBlank();
        if ((scope == ReportContracts.Scope.ALL && (expenseSpecific || incomeSpecific))
                || (scope == ReportContracts.Scope.EXPENSE && incomeSpecific)
                || (scope == ReportContracts.Scope.INCOME && expenseSpecific)) {
            throw fieldError("scope", "当前账目范围包含不适用的专属筛选，请重新选择条件。");
        }
    }

    private static String money(BigDecimal amount) { return amount.setScale(2).toPlainString(); }

    private static ApiException fieldError(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                Map.of(field, List.of(message)));
    }
}
