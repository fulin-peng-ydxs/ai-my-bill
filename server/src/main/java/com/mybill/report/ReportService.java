package com.mybill.report;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.shared.api.ApiException;
import com.mybill.shared.time.BusinessDateRange;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
final class ReportService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final int MAX_BUCKETS = 400;
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

    ReportContracts.TimeReport time(CurrentPrincipal principal, ReportContracts.Scope scope,
                                    BusinessDateRange range, LocalDate customStart, LocalDate customEnd,
                                    ReportContracts.TimeGrain grain, String query, UUID fundingChannelId,
                                    UUID primaryCategoryId, UUID secondaryCategoryId, UUID productId,
                                    UUID purchaseChannelId, UUID locationLabelId, UUID incomeCategoryId,
                                    UUID payerId, String incomeName) {
        validateScope(scope, primaryCategoryId, secondaryCategoryId, productId, purchaseChannelId,
                locationLabelId, incomeCategoryId, payerId, incomeName);
        BusinessDateRange.Bounds bounds = resolve(range, customStart, customEnd);
        LocalDate firstBucket = bucketStart(bounds.start(), grain);
        if (bucketCount(firstBucket, bounds.end(), grain) > MAX_BUCKETS) {
            throw fieldError("grain", "当前粒度会产生超过 400 个时间点，请缩短日期范围或选择更粗粒度。");
        }
        ReportFilter current = filter(scope, bounds.start(), bounds.end(), query, fundingChannelId,
                primaryCategoryId, secondaryCategoryId, productId, purchaseChannelId, locationLabelId,
                incomeCategoryId, payerId, incomeName);
        return tenantTransactions.execute(principal, () -> buildTimeReport(principal, grain, bounds, current));
    }

    private ReportContracts.TimeReport buildTimeReport(CurrentPrincipal principal, ReportContracts.TimeGrain grain,
                                                        BusinessDateRange.Bounds bounds, ReportFilter filter) {
        Map<LocalDate, ReportRepository.BucketTotals> rows = new HashMap<>();
        repository.timeBuckets(filter, grain).forEach(row -> rows.put(row.start(), row));
        List<ReportContracts.TimeBucket> buckets = new ArrayList<>();
        BigDecimal income = BigDecimal.ZERO, gross = BigDecimal.ZERO, adjustment = BigDecimal.ZERO;
        for (LocalDate cursor = bucketStart(bounds.start(), grain); !cursor.isAfter(bounds.end()); cursor = next(cursor, grain)) {
            ReportRepository.BucketTotals row = rows.getOrDefault(cursor,
                    new ReportRepository.BucketTotals(cursor, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, 0, 0, 0));
            income = income.add(row.totalIncome()); gross = gross.add(row.grossExpense());
            adjustment = adjustment.add(row.adjustmentAmount());
            LocalDate visibleStart = cursor.isBefore(bounds.start()) ? bounds.start() : cursor;
            LocalDate visibleEnd = bucketEnd(cursor, grain).isAfter(bounds.end()) ? bounds.end() : bucketEnd(cursor, grain);
            BigDecimal net = row.grossExpense().subtract(row.adjustmentAmount());
            BigDecimal cumulativeNet = gross.subtract(adjustment);
            buckets.add(new ReportContracts.TimeBucket(visibleStart, visibleEnd, label(visibleStart, visibleEnd, grain),
                    money(row.totalIncome()), money(row.grossExpense()), money(row.adjustmentAmount()), money(net),
                    money(row.totalIncome().subtract(net)), money(income), money(gross), money(adjustment),
                    money(cumulativeNet), money(income.subtract(cumulativeNet)), row.incomeCount(), row.expenseCount(),
                    row.adjustmentCount(), row.itemCount()));
        }
        ReportRepository.Totals currentTotals = repository.summary(filter);
        LocalDate today = LocalDate.now(clock.withZone(BUSINESS_ZONE));
        LocalDate effectiveEnd = bounds.end().isAfter(today) ? today : bounds.end();
        LocalDate accountCreated = repository.accountCreatedDate(principal.userId());
        List<ReportContracts.MetricComparison> comparisons = comparisons(filter, currentTotals, bounds.start(), effectiveEnd, accountCreated);
        return new ReportContracts.TimeReport(grain, bounds.start(), bounds.end(), List.copyOf(buckets), comparisons);
    }

    private List<ReportContracts.MetricComparison> comparisons(ReportFilter base, ReportRepository.Totals current,
                                                                LocalDate start, LocalDate effectiveEnd,
                                                                LocalDate accountCreated) {
        EnumMap<ReportContracts.TimeMetric, BigDecimal> currentValues = values(current);
        if (effectiveEnd.isBefore(start)) return currentValues.entrySet().stream().map(entry ->
                new ReportContracts.MetricComparison(entry.getKey(), money(entry.getValue()),
                        unavailable(start, effectiveEnd, "当前区间尚未开始，无法比较。"),
                        unavailable(start, effectiveEnd, "当前区间尚未开始，无法比较。"))).toList();
        long days = ChronoUnit.DAYS.between(start, effectiveEnd) + 1;
        LocalDate previousEnd = start.minusDays(1), previousStart = previousEnd.minusDays(days - 1);
        LocalDate yearStart = start.minusYears(1), yearEnd = yearStart.plusDays(days - 1);
        ReportRepository.Totals previous = repository.summary(withDates(base, previousStart, previousEnd));
        ReportRepository.Totals year = repository.summary(withDates(base, yearStart, yearEnd));
        EnumMap<ReportContracts.TimeMetric, BigDecimal> previousValues = values(previous), yearValues = values(year);
        List<ReportContracts.MetricComparison> result = new ArrayList<>();
        for (var entry : currentValues.entrySet()) {
            result.add(new ReportContracts.MetricComparison(entry.getKey(), money(entry.getValue()),
                    comparison(previousStart, previousEnd, entry.getValue(), previousValues.get(entry.getKey()), accountCreated),
                    comparison(yearStart, yearEnd, entry.getValue(), yearValues.get(entry.getKey()), accountCreated)));
        }
        return List.copyOf(result);
    }

    private static ReportContracts.PeriodComparison comparison(LocalDate start, LocalDate end, BigDecimal current,
                                                                 BigDecimal compared, LocalDate accountCreated) {
        if (accountCreated.isAfter(start)) return unavailable(start, end, "账号在对比区间开始后创建，对比区间不完整。");
        if (compared.signum() == 0) return unavailable(start, end, "对比区间金额为 0，无法计算变化率。");
        String percent = current.subtract(compared).divide(compared.abs(), 6, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP).toPlainString();
        return new ReportContracts.PeriodComparison(start, end, money(compared), percent, null);
    }

    private static ReportContracts.PeriodComparison unavailable(LocalDate start, LocalDate end, String reason) {
        return new ReportContracts.PeriodComparison(start, end, null, null, reason);
    }

    private static EnumMap<ReportContracts.TimeMetric, BigDecimal> values(ReportRepository.Totals totals) {
        EnumMap<ReportContracts.TimeMetric, BigDecimal> values = new EnumMap<>(ReportContracts.TimeMetric.class);
        BigDecimal net = totals.grossExpense().subtract(totals.adjustmentAmount());
        values.put(ReportContracts.TimeMetric.TOTAL_INCOME, totals.totalIncome());
        values.put(ReportContracts.TimeMetric.GROSS_EXPENSE, totals.grossExpense());
        values.put(ReportContracts.TimeMetric.ADJUSTMENT, totals.adjustmentAmount());
        values.put(ReportContracts.TimeMetric.NET_EXPENSE, net);
        values.put(ReportContracts.TimeMetric.BALANCE, totals.totalIncome().subtract(net));
        return values;
    }

    private static ReportFilter withDates(ReportFilter filter, LocalDate start, LocalDate end) {
        return new ReportFilter(filter.scope(), start, end, filter.keyword(), filter.fundingChannelId(),
                filter.primaryCategoryId(), filter.secondaryCategoryId(), filter.productId(), filter.purchaseChannelId(),
                filter.locationLabelId(), filter.incomeCategoryId(), filter.payerId(), filter.incomeName());
    }

    private static ReportFilter filter(ReportContracts.Scope scope, LocalDate start, LocalDate end, String query,
                                       UUID fundingChannelId, UUID primaryCategoryId, UUID secondaryCategoryId,
                                       UUID productId, UUID purchaseChannelId, UUID locationLabelId,
                                       UUID incomeCategoryId, UUID payerId, String incomeName) {
        return new ReportFilter(scope, start, end, query == null ? "" : query.strip(), fundingChannelId,
                primaryCategoryId, secondaryCategoryId, productId, purchaseChannelId, locationLabelId,
                incomeCategoryId, payerId, incomeName == null || incomeName.isBlank() ? null : incomeName.strip());
    }

    private BusinessDateRange.Bounds resolve(BusinessDateRange range, LocalDate start, LocalDate end) {
        try { return range.resolve(clock, start, end); }
        catch (IllegalArgumentException invalid) { throw fieldError("startDate", "指定日期必须完整，且结束日期不能早于开始日期。"); }
    }

    private static LocalDate bucketStart(LocalDate date, ReportContracts.TimeGrain grain) {
        return switch (grain) {
            case DAY -> date;
            case WEEK -> date.minusDays(date.getDayOfWeek().getValue() - 1L);
            case MONTH -> date.withDayOfMonth(1);
            case QUARTER -> LocalDate.of(date.getYear(), ((date.getMonthValue() - 1) / 3) * 3 + 1, 1);
            case YEAR -> date.withDayOfYear(1);
        };
    }

    private static LocalDate next(LocalDate date, ReportContracts.TimeGrain grain) {
        return switch (grain) { case DAY -> date.plusDays(1); case WEEK -> date.plusWeeks(1);
            case MONTH -> date.plusMonths(1); case QUARTER -> date.plusMonths(3); case YEAR -> date.plusYears(1); };
    }

    private static LocalDate bucketEnd(LocalDate start, ReportContracts.TimeGrain grain) { return next(start, grain).minusDays(1); }
    private static int bucketCount(LocalDate start, LocalDate end, ReportContracts.TimeGrain grain) {
        int count = 0; for (LocalDate cursor = start; !cursor.isAfter(end) && count <= MAX_BUCKETS; cursor = next(cursor, grain)) count++;
        return count;
    }
    private static String label(LocalDate start, LocalDate end, ReportContracts.TimeGrain grain) {
        DateTimeFormatter shortDate = DateTimeFormatter.ofPattern("M月d日");
        return switch (grain) { case DAY -> shortDate.format(start); case WEEK -> shortDate.format(start) + "–" + shortDate.format(end);
            case MONTH -> start.format(DateTimeFormatter.ofPattern("yyyy年M月"));
            case QUARTER -> start.getYear() + "年Q" + ((start.getMonthValue() - 1) / 3 + 1);
            case YEAR -> start.getYear() + "年"; };
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
