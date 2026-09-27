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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** T22 支出分析；质量规则只产生线索，不修改或标记账目。 */
@Service
final class ExpenseReportService {
    static final String QUALITY_VERSION = "expense-quality-v1";
    static final int PRICE_WINDOW_DAYS = 180;
    static final int MINIMUM_PRICE_SAMPLES = 3;
    static final BigDecimal HIGH_PRICE_MULTIPLIER = new BigDecimal("1.50");
    static final int DUPLICATE_WINDOW_MINUTES = 10;
    private static final int POINT_LIMIT = 50;
    private static final int QUALITY_LIMIT = 100;

    private final ReportRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    ExpenseReportService(ReportRepository repository, TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository;
        this.tenantTransactions = tenantTransactions;
        this.clock = clock;
    }

    ReportContracts.ExpenseReport report(CurrentPrincipal principal, ReportContracts.ExpenseDimension dimension,
                                         BusinessDateRange range, LocalDate customStart, LocalDate customEnd,
                                         String query, UUID fundingChannelId, UUID primaryCategoryId,
                                         UUID secondaryCategoryId, UUID productId, UUID purchaseChannelId,
                                         UUID locationLabelId) {
        BusinessDateRange.Bounds bounds;
        try { bounds = range.resolve(clock, customStart, customEnd); }
        catch (IllegalArgumentException invalid) { throw fieldError("startDate", "指定日期必须完整，且结束日期不能早于开始日期。"); }
        ReportFilter filter = new ReportFilter(ReportContracts.Scope.EXPENSE, bounds.start(), bounds.end(),
                query == null ? "" : query.strip(), fundingChannelId, primaryCategoryId, secondaryCategoryId,
                productId, purchaseChannelId, locationLabelId, null, null, null);
        return tenantTransactions.execute(principal, () -> build(filter, dimension));
    }

    private ReportContracts.ExpenseReport build(ReportFilter filter, ReportContracts.ExpenseDimension dimension) {
        int limit = dimension == ReportContracts.ExpenseDimension.QUALITY ? QUALITY_LIMIT : POINT_LIMIT;
        List<ReportRepository.ExpenseRow> rows = dimension == ReportContracts.ExpenseDimension.QUALITY
                ? repository.expenseQuality(filter, limit + 1, PRICE_WINDOW_DAYS, MINIMUM_PRICE_SAMPLES,
                        HIGH_PRICE_MULTIPLIER, DUPLICATE_WINDOW_MINUTES)
                : repository.expenseDimension(filter, dimension, limit + 1);
        boolean truncated = rows.size() > limit;
        List<ReportRepository.ExpenseRow> visible = truncated ? rows.subList(0, limit) : rows;
        BigDecimal total = dimension == ReportContracts.ExpenseDimension.PRICE
                || dimension == ReportContracts.ExpenseDimension.QUALITY ? BigDecimal.ZERO
                : repository.summary(filter).grossExpense();
        List<ReportContracts.ExpensePoint> points = new ArrayList<>();
        for (ReportRepository.ExpenseRow row : visible) points.add(point(dimension, row, total));
        ReportContracts.QualityRule rule = dimension == ReportContracts.ExpenseDimension.QUALITY
                ? new ReportContracts.QualityRule(QUALITY_VERSION, PRICE_WINDOW_DAYS, MINIMUM_PRICE_SAMPLES,
                        HIGH_PRICE_MULTIPLIER.setScale(2).toPlainString(), DUPLICATE_WINDOW_MINUTES) : null;
        return new ReportContracts.ExpenseReport(dimension, measureLabel(dimension), List.copyOf(points), truncated, rule);
    }

    private static ReportContracts.ExpensePoint point(ReportContracts.ExpenseDimension dimension,
                                                       ReportRepository.ExpenseRow row, BigDecimal total) {
        String share = total.signum() == 0 || row.issueType() != null || dimension == ReportContracts.ExpenseDimension.PRICE
                || dimension == ReportContracts.ExpenseDimension.FREQUENCY
                || dimension == ReportContracts.ExpenseDimension.QUALITY ? null
                : row.amount().multiply(BigDecimal.valueOf(100)).divide(total, 2, RoundingMode.HALF_UP).toPlainString();
        return new ReportContracts.ExpensePoint(row.group(), row.label(), row.value(), money(row.amount()),
                row.itemCount(), share, detail(dimension, row), warning(dimension, row), row.entryId(),
                row.drillStartDate(), row.drillEndDate());
    }

    private static String detail(ReportContracts.ExpenseDimension dimension, ReportRepository.ExpenseRow row) {
        return switch (dimension) {
            case PRODUCT -> "数量 " + decimal(row.quantity()) + " " + row.unitName() + " · 平均填写单价 "
                    + money(row.averageUnitPrice()) + " · 最近 " + money(row.latestUnitPrice());
            case PRICE -> "最低 " + money(row.minimumUnitPrice()) + " · 最高 " + money(row.maximumUnitPrice())
                    + " · 最近 " + money(row.latestUnitPrice()) + " · 平均实际单位成本 " + money(row.averageActualCost());
            case HABIT -> switch (row.issueType() == null ? "DISTRIBUTION" : row.issueType()) {
                case "AVERAGE_DAILY" -> "按所选日期内全部自然日计算 · " + row.itemCount() + " 条消费明细";
                case "AVERAGE_MONTHLY" -> "按所选日期覆盖的自然月计算 · " + row.itemCount() + " 条消费明细";
                case "AVERAGE_ENTRY" -> "每条消费明细的平均实付 · " + row.itemCount() + " 条消费明细";
                default -> row.itemCount() + " 条消费明细";
            };
            case FREQUENCY -> "LONG_UNUSED".equals(row.issueType())
                    ? "报告期内 0 条 · 上次购买 " + row.latestDate() + " · 历史共 " + row.itemCount() + " 条"
                    : "最近购买 " + row.latestDate() + " · 平均复购间隔 "
                    + (row.averageIntervalDays() == null ? "样本不足" : decimal(row.averageIntervalDays()) + " 天");
            case QUALITY -> switch (row.issueType()) {
                case "HIGH_PRICE" -> "实际单位成本 " + money(row.actualValue()) + " · 历史中位数 " + money(row.baselineValue());
                case "DUPLICATE" -> "同商品、实付金额和资金渠道在 10 分钟内重复出现";
                default -> "缺少正式一级分类";
            };
            default -> row.itemCount() + " 条消费明细";
        };
    }

    private static String warning(ReportContracts.ExpenseDimension dimension, ReportRepository.ExpenseRow row) {
        if (dimension != ReportContracts.ExpenseDimension.QUALITY || row.issueType() == null) return null;
        return switch (row.issueType()) {
            case "HIGH_PRICE" -> "异常高价线索";
            case "DUPLICATE" -> "疑似重复线索";
            default -> "未分类线索";
        };
    }

    private static String measureLabel(ReportContracts.ExpenseDimension dimension) {
        return dimension == ReportContracts.ExpenseDimension.PRICE ? "填写单价（元）"
                : dimension == ReportContracts.ExpenseDimension.FREQUENCY ? "消费明细数"
                : dimension == ReportContracts.ExpenseDimension.QUALITY ? "质量线索"
                : "原始支出（元）";
    }

    private static String money(BigDecimal value) {
        return value == null ? "0.00" : value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
    private static String decimal(BigDecimal value) {
        return value == null ? "0" : value.stripTrailingZeros().toPlainString();
    }
    private static ApiException fieldError(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                Map.of(field, List.of(message)));
    }
}
