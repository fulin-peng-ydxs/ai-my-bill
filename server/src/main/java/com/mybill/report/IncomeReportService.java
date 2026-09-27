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
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** T23 收入多维分析；全部结果只读取当前认证租户的有效收入。 */
@Service
final class IncomeReportService {
    private static final int POINT_LIMIT = 50;

    private final ReportRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    IncomeReportService(ReportRepository repository, TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository;
        this.tenantTransactions = tenantTransactions;
        this.clock = clock;
    }

    ReportContracts.IncomeReport report(CurrentPrincipal principal, ReportContracts.IncomeDimension dimension,
                                        BusinessDateRange range, LocalDate customStart, LocalDate customEnd,
                                        String query, UUID fundingChannelId, UUID incomeCategoryId,
                                        UUID payerId, String incomeName) {
        BusinessDateRange.Bounds bounds;
        try { bounds = range.resolve(clock, customStart, customEnd); }
        catch (IllegalArgumentException invalid) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED",
                    "指定日期必须完整，且结束日期不能早于开始日期。", false,
                    Map.of("startDate", List.of("指定日期必须完整，且结束日期不能早于开始日期。")));
        }
        ReportFilter filter = new ReportFilter(ReportContracts.Scope.INCOME, bounds.start(), bounds.end(),
                query == null ? "" : query.strip(), fundingChannelId, null, null, null, null, null,
                incomeCategoryId, payerId, incomeName == null || incomeName.isBlank() ? null : incomeName.strip());
        return tenantTransactions.execute(principal, () -> build(filter, dimension));
    }

    private ReportContracts.IncomeReport build(ReportFilter filter, ReportContracts.IncomeDimension dimension) {
        List<ReportRepository.IncomeRow> rows = repository.incomeDimension(filter, dimension, POINT_LIMIT + 1);
        boolean truncated = rows.size() > POINT_LIMIT;
        List<ReportRepository.IncomeRow> visible = truncated ? rows.subList(0, POINT_LIMIT) : rows;
        BigDecimal total = dimension == ReportContracts.IncomeDimension.FREQUENCY
                ? BigDecimal.ZERO : repository.summary(filter).totalIncome();
        List<ReportContracts.IncomePoint> points = visible.stream()
                .map(row -> point(dimension, row, total)).toList();
        return new ReportContracts.IncomeReport(dimension,
                dimension == ReportContracts.IncomeDimension.FREQUENCY ? "收入明细数" : "收入金额（元）",
                points, truncated);
    }

    private static ReportContracts.IncomePoint point(ReportContracts.IncomeDimension dimension,
                                                      ReportRepository.IncomeRow row, BigDecimal total) {
        String share = total.signum() == 0 ? null
                : row.amount().multiply(BigDecimal.valueOf(100)).divide(total, 2, RoundingMode.HALF_UP).toPlainString();
        String detail = dimension == ReportContracts.IncomeDimension.FREQUENCY
                ? "累计收入 ¥" + money(row.totalAmount()) + " · 最近记录 " + row.latestDate()
                : row.itemCount() + " 条收入明细" + (dimension == ReportContracts.IncomeDimension.NAME
                ? " · 最近记录 " + row.latestDate() : "");
        return new ReportContracts.IncomePoint(row.group(), row.label(), row.value(), money(row.amount()),
                row.itemCount(), share, detail);
    }

    private static String money(BigDecimal value) {
        return value == null ? "0.00" : value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
