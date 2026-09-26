package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.ledger.LedgerQueryContracts.*;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

import com.mybill.shared.time.BusinessDateRange;

@Validated
@RestController
@RequestMapping("/api/v1/ledger-entries")
public class LedgerQueryController {
    private final LedgerQueryService service;
    LedgerQueryController(LedgerQueryService service) { this.service = service; }

    @GetMapping
    LedgerPage query(@AuthenticationPrincipal CurrentPrincipal principal,
                     @RequestParam(defaultValue = "ALL") EntryTypeFilter type,
                     @RequestParam(defaultValue = "ACTIVE") LifecycleFilter lifecycle,
                     @RequestParam(required = false) UUID fundingChannelId,
                     @RequestParam(required = false) UUID primaryCategoryId,
                     @RequestParam(required = false) UUID secondaryCategoryId,
                     @RequestParam(required = false) UUID productId,
                     @RequestParam(required = false) UUID purchaseChannelId,
                     @RequestParam(required = false) UUID locationLabelId,
                     @RequestParam(required = false) UUID incomeCategoryId,
                     @RequestParam(required = false) UUID payerId,
                     @RequestParam(required = false) @Size(max = 100) String incomeName,
                     @RequestParam(defaultValue = "TODAY") BusinessDateRange range,
                     @RequestParam(required = false) LocalDate startDate,
                     @RequestParam(required = false) LocalDate endDate,
                     @RequestParam(defaultValue = "") @Size(max = 200) String query,
                     @RequestParam(required = false) @Size(max = 500) String cursor) {
        return service.query(principal, type, lifecycle, fundingChannelId, primaryCategoryId, secondaryCategoryId,
                productId, purchaseChannelId, locationLabelId, incomeCategoryId, payerId, incomeName,
                range, startDate, endDate, query, cursor);
    }
}
