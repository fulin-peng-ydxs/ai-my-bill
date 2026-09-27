package com.mybill.report;

import com.mybill.shared.persistence.DatabaseRow;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Repository
class ReportRepository {
    private final MybatisOperations operations;
    private final ReportRepositoryMapper mapper;

    ReportRepository(MybatisOperations operations, ReportRepositoryMapper mapper) {
        this.operations = operations;
        this.mapper = mapper;
    }

    Totals summary(ReportFilter filter) {
        return bind(operations.select(mapper::summary), filter)
                .map(ReportRepository::map).single();
    }

    List<BucketTotals> timeBuckets(ReportFilter filter, ReportContracts.TimeGrain grain) {
        return bind(operations.select(mapper::timeBuckets), filter)
                .param("grain", grain.name())
                .map(ReportRepository::mapBucket).list();
    }

    LocalDate accountCreatedDate(UUID userId) {
        return operations.select(mapper::accountCreatedDate).param("userId", userId)
                .map((row, number) -> row.getObject("created_date", LocalDate.class)).single();
    }

    private static MybatisOperations.SelectSpec bind(MybatisOperations.SelectSpec call, ReportFilter filter) {
        return call
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
                .param("incomeName", filter.incomeName());
    }

    private static Totals map(DatabaseRow row, int rowNumber) throws SQLException {
        return new Totals(
                row.getBigDecimal("total_income"), row.getBigDecimal("gross_expense"),
                row.getBigDecimal("adjustment_amount"), row.getLong("income_count"),
                row.getLong("expense_count"), row.getLong("adjustment_count")
        );
    }

    private static BucketTotals mapBucket(DatabaseRow row, int rowNumber) throws SQLException {
        return new BucketTotals(row.getObject("bucket_start", LocalDate.class),
                row.getBigDecimal("total_income"), row.getBigDecimal("gross_expense"),
                row.getBigDecimal("adjustment_amount"), row.getLong("income_count"),
                row.getLong("expense_count"), row.getLong("adjustment_count"));
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    record Totals(BigDecimal totalIncome, BigDecimal grossExpense, BigDecimal adjustmentAmount,
                  long incomeCount, long expenseCount, long adjustmentCount) { }
    record BucketTotals(LocalDate start, BigDecimal totalIncome, BigDecimal grossExpense,
                        BigDecimal adjustmentAmount, long incomeCount, long expenseCount,
                        long adjustmentCount) {
        long itemCount() { return incomeCount + expenseCount + adjustmentCount; }
    }
}
