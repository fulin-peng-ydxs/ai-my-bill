package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.ledger.DailyTemplateContracts.*;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class DailyTemplateController {
    private final DailyTemplateService service;
    DailyTemplateController(DailyTemplateService service) { this.service = service; }

    @GetMapping("/daily-templates")
    TemplateList list(@AuthenticationPrincipal CurrentPrincipal principal, @RequestParam EntryType type) {
        return service.list(principal, type);
    }

    /** T14 的有效明细上下文动作只需调用该稳定合同，不在 T13 提前实现明细页面。 */
    @PutMapping("/ledger-entries/{ledgerId}/daily-template")
    TemplateSummary upsert(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID ledgerId) {
        return service.upsertFromLedger(principal, ledgerId);
    }

    @PostMapping("/daily-templates/{templateId}/select")
    TemplateSelection select(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID templateId) {
        return service.select(principal, templateId);
    }

    @DeleteMapping("/daily-templates/{templateId}")
    ResponseEntity<Void> remove(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID templateId) {
        service.remove(principal, templateId);
        return ResponseEntity.noContent().build();
    }
}
