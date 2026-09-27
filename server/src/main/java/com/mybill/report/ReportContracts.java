package com.mybill.report;

import java.util.List;
import java.time.LocalDate;
import java.util.UUID;

final class ReportContracts {
    private ReportContracts() { }

    enum Scope { ALL, EXPENSE, INCOME }
    enum TimeGrain { DAY, WEEK, MONTH, QUARTER, YEAR }
    enum TimeMetric { TOTAL_INCOME, GROSS_EXPENSE, ADJUSTMENT, NET_EXPENSE, BALANCE }
    enum ExpenseDimension { CATEGORY, PRODUCT, FUNDING_CHANNEL, PURCHASE_CHANNEL, LOCATION, HABIT, PRICE, FREQUENCY, QUALITY }

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

    /** value 是稳定下钻值；label/detail 只负责展示，不参与明细过滤。 */
    record ExpensePoint(String group, String label, String value, String amount,
                        long itemCount, String sharePercent, String detail,
                        String warning, UUID entryId, LocalDate drillStartDate,
                        LocalDate drillEndDate) { }

    record QualityRule(String version, int priceWindowDays, int minimumPriceSamples,
                       String highPriceMultiplier, int duplicateWindowMinutes) { }

    record ExpenseReport(ExpenseDimension dimension, String measureLabel,
                         List<ExpensePoint> points, boolean truncated,
                         QualityRule qualityRule) { }
}
