package com.mybill.report;

import java.util.List;
import java.time.LocalDate;

final class ReportContracts {
    private ReportContracts() { }

    enum Scope { ALL, EXPENSE, INCOME }
    enum TimeGrain { DAY, WEEK, MONTH, QUARTER, YEAR }
    enum TimeMetric { TOTAL_INCOME, GROSS_EXPENSE, ADJUSTMENT, NET_EXPENSE, BALANCE }

    record Summary(
            String totalIncome,
            String grossExpense,
            String adjustmentAmount,
            String netExpense,
            String balance,
            long matchingItemCount,
            List<DataPoint> dataPoints
    ) { }

    /** value 是下钻条件而不是展示金额，避免前端把指标值误当维度值。 */
    record DataPoint(String label, String value, String amount, long itemCount) { }

    record TimeBucket(LocalDate startDate, LocalDate endDate, String label,
                      String totalIncome, String grossExpense, String adjustmentAmount,
                      String netExpense, String balance,
                      String cumulativeIncome, String cumulativeGrossExpense,
                      String cumulativeAdjustmentAmount, String cumulativeNetExpense,
                      String cumulativeBalance, long incomeCount, long expenseCount,
                      long adjustmentCount, long itemCount) { }

    record PeriodComparison(LocalDate startDate, LocalDate endDate, String amount,
                            String changePercent, String unavailableReason) { }

    record MetricComparison(TimeMetric metric, String currentAmount,
                            PeriodComparison periodOverPeriod, PeriodComparison yearOverYear) { }

    record TimeReport(TimeGrain grain, LocalDate startDate, LocalDate endDate,
                      List<TimeBucket> buckets, List<MetricComparison> comparisons) { }
}
