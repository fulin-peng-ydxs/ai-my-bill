package com.mybill.report;

import java.util.List;

final class ReportContracts {
    private ReportContracts() { }

    enum Scope { ALL, EXPENSE, INCOME }

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
}
