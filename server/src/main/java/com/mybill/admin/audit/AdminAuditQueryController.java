package com.mybill.admin.audit;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/admin/audit-logs")
public class AdminAuditQueryController {
    private final AdminAuditQueryService service;

    AdminAuditQueryController(AdminAuditQueryService service) {
        this.service = service;
    }

    @GetMapping
    AdminAuditQueryContracts.AuditLogPage list(
            @RequestParam(defaultValue = "") @Size(max = 64) String administrator,
            @RequestParam(defaultValue = "") @Size(max = 64) String action,
            @RequestParam(defaultValue = "") @Size(max = 128) String object,
            @RequestParam(required = false) AuditResult result,
            @RequestParam(defaultValue = "ALL") AdminAuditQueryContracts.Period period,
            @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int size) {
        return service.list(administrator, action, object, result, period, page, size);
    }
}
