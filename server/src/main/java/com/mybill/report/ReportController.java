package com.mybill.report;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.shared.time.BusinessDateRange;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

@Validated
@RestController
@RequestMapping("/api/v1/reports")
public class ReportController {
    private final ReportService service;
    private final ExpenseReportService expenseService;

    ReportController(ReportService service, ExpenseReportService expenseService) {
        this.service = service;
        this.expenseService = expenseService;
    }

    @GetMapping("/summary")
    ReportContracts.Summary summary(
            @AuthenticationPrincipal CurrentPrincipal principal,
            @RequestParam(defaultValue = "ALL") ReportContracts.Scope scope,
            @RequestParam(defaultValue = "THIS_MONTH") BusinessDateRange range,
            @RequestParam(required = false) LocalDate startDate,
            @RequestParam(required = false) LocalDate endDate,
            @RequestParam(defaultValue = "") @Size(max = 200) String query,
            @RequestParam(required = false) UUID fundingChannelId,
            @RequestParam(required = false) UUID primaryCategoryId,
            @RequestParam(required = false) UUID secondaryCategoryId,
            @RequestParam(required = false) UUID productId,
            @RequestParam(required = false) UUID purchaseChannelId,
            @RequestParam(required = false) UUID locationLabelId,
            @RequestParam(required = false) UUID incomeCategoryId,
            @RequestParam(required = false) UUID payerId,
            @RequestParam(required = false) @Size(max = 100) String incomeName) {
        return service.summary(principal, scope, range, startDate, endDate, query, fundingChannelId,
                primaryCategoryId, secondaryCategoryId, productId, purchaseChannelId, locationLabelId,
                incomeCategoryId, payerId, incomeName);
    }

    @GetMapping("/time")
    ReportContracts.TimeReport time(
            @AuthenticationPrincipal CurrentPrincipal principal,
            @RequestParam(defaultValue = "ALL") ReportContracts.Scope scope,
            @RequestParam(defaultValue = "THIS_MONTH") BusinessDateRange range,
            @RequestParam(required = false) LocalDate startDate,
            @RequestParam(required = false) LocalDate endDate,
            @RequestParam(defaultValue = "DAY") ReportContracts.TimeGrain grain,
            @RequestParam(defaultValue = "") @Size(max = 200) String query,
            @RequestParam(required = false) UUID fundingChannelId,
            @RequestParam(required = false) UUID primaryCategoryId,
            @RequestParam(required = false) UUID secondaryCategoryId,
            @RequestParam(required = false) UUID productId,
            @RequestParam(required = false) UUID purchaseChannelId,
            @RequestParam(required = false) UUID locationLabelId,
            @RequestParam(required = false) UUID incomeCategoryId,
            @RequestParam(required = false) UUID payerId,
            @RequestParam(required = false) @Size(max = 100) String incomeName) {
        return service.time(principal, scope, range, startDate, endDate, grain, query, fundingChannelId,
                primaryCategoryId, secondaryCategoryId, productId, purchaseChannelId, locationLabelId,
                incomeCategoryId, payerId, incomeName);
    }

    @GetMapping("/expenses")
    ReportContracts.ExpenseReport expenses(
            @AuthenticationPrincipal CurrentPrincipal principal,
            @RequestParam ReportContracts.ExpenseDimension dimension,
            @RequestParam(defaultValue = "THIS_MONTH") BusinessDateRange range,
            @RequestParam(required = false) LocalDate startDate,
            @RequestParam(required = false) LocalDate endDate,
            @RequestParam(defaultValue = "") @Size(max = 200) String query,
            @RequestParam(required = false) UUID fundingChannelId,
            @RequestParam(required = false) UUID primaryCategoryId,
            @RequestParam(required = false) UUID secondaryCategoryId,
            @RequestParam(required = false) UUID productId,
            @RequestParam(required = false) UUID purchaseChannelId,
            @RequestParam(required = false) UUID locationLabelId) {
        return expenseService.report(principal, dimension, range, startDate, endDate, query, fundingChannelId,
                primaryCategoryId, secondaryCategoryId, productId, purchaseChannelId, locationLabelId);
    }
}
