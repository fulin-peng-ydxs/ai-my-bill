package com.mybill.report;

import com.mybill.shared.persistence.DatabaseRow;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.SQLException;

@Repository
class ReportRepository {
    private final MybatisOperations operations;
    private final ReportRepositoryMapper mapper;

    ReportRepository(MybatisOperations operations, ReportRepositoryMapper mapper) {
        this.operations = operations;
        this.mapper = mapper;
    }

    Totals summary(ReportFilter filter) {
        return operations.select(mapper::summary)
                .param("scope", filter.scope().name())
                .param("startDate", filter.startDate()).param("endDate", filter.endDate())
                .param("keyword", filter.keyword().isEmpty() ? null : "%" + escapeLike(filter.keyword()) + "%")
                .param("fundingChannelId", filter.fundingChannelId())
                .param("primaryCategoryId", filter.primaryCategoryId())
                .param("secondaryCategoryId", filter.secondaryCategoryId())
                .param("productId", filter.productId())
                .param("purchaseChannelId", filter.purchaseChannelId())
                .param("locationLabelId", filter.locationLabelId())
                .param("incomeCategoryId", filter.incomeCategoryId())
                .param("payerId", filter.payerId())
                .param("incomeName", filter.incomeName())
                .map(ReportRepository::map).single();
    }

    private static Totals map(DatabaseRow row, int rowNumber) throws SQLException {
        return new Totals(
                row.getBigDecimal("total_income"), row.getBigDecimal("gross_expense"),
                row.getBigDecimal("adjustment_amount"), row.getLong("income_count"),
                row.getLong("expense_count"), row.getLong("adjustment_count")
        );
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    record Totals(BigDecimal totalIncome, BigDecimal grossExpense, BigDecimal adjustmentAmount,
                  long incomeCount, long expenseCount, long adjustmentCount) { }
}
