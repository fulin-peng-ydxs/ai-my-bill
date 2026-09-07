package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.ledger.LedgerLifecycleContracts.LifecycleRequest;
import com.mybill.ledger.LedgerLifecycleContracts.LifecycleResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@Validated
@RestController
@RequestMapping("/api/v1")
public class LedgerLifecycleController {
    private final LedgerLifecycleService service;
    LedgerLifecycleController(LedgerLifecycleService service) { this.service = service; }

    @PostMapping("/ledger-entries/{id}/trash")
    LifecycleResponse trashLedger(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id,
                                  @RequestHeader("Idempotency-Key") String key,
                                  @Valid @RequestBody LifecycleRequest request) {
        return service.trashLedger(principal, id, key, request);
    }

    @PostMapping("/ledger-entries/{id}/restore")
    LifecycleResponse restoreLedger(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id,
                                    @RequestHeader("Idempotency-Key") String key,
                                    @Valid @RequestBody LifecycleRequest request) {
        return service.restoreLedger(principal, id, key, request);
    }

    @PostMapping("/ledger-entries/{id}/purge")
    ResponseEntity<Void> purgeLedger(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id,
                                     @RequestHeader("Idempotency-Key") String key,
                                     @Valid @RequestBody LifecycleRequest request) {
        service.purgeLedger(principal, id, key, request);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/adjustments/{id}/trash")
    LifecycleResponse trashAdjustment(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id,
                                      @RequestHeader("Idempotency-Key") String key,
                                      @Valid @RequestBody LifecycleRequest request) {
        return service.trashAdjustment(principal, id, key, request);
    }

    @PostMapping("/adjustments/{id}/restore")
    LifecycleResponse restoreAdjustment(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id,
                                        @RequestHeader("Idempotency-Key") String key,
                                        @Valid @RequestBody LifecycleRequest request) {
        return service.restoreAdjustment(principal, id, key, request);
    }

    @PostMapping("/adjustments/{id}/purge")
    ResponseEntity<Void> purgeAdjustment(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id,
                                         @RequestHeader("Idempotency-Key") String key,
                                         @Valid @RequestBody LifecycleRequest request) {
        service.purgeAdjustment(principal, id, key, request);
        return ResponseEntity.noContent().build();
    }
}
