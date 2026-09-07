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
                     @RequestParam(defaultValue = "TODAY") DateRange range,
                     @RequestParam(required = false) LocalDate startDate,
                     @RequestParam(required = false) LocalDate endDate,
                     @RequestParam(defaultValue = "") @Size(max = 200) String query,
                     @RequestParam(required = false) @Size(max = 500) String cursor) {
        return service.query(principal, type, lifecycle, fundingChannelId, range, startDate, endDate, query, cursor);
    }
}
