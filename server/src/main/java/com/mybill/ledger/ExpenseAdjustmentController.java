package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.ledger.ExpenseAdjustmentContracts.AdjustmentResponse;
import com.mybill.ledger.ExpenseAdjustmentContracts.CreateAdjustmentRequest;
import com.mybill.ledger.ExpenseAdjustmentContracts.CreationResult;
import com.mybill.ledger.ExpenseAdjustmentContracts.RevokeAdjustmentRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@Validated
@RestController
@RequestMapping("/api/v1")
public class ExpenseAdjustmentController {
    private final ExpenseAdjustmentService service;
    ExpenseAdjustmentController(ExpenseAdjustmentService service) { this.service = service; }

    @PostMapping("/ledger-entries/{expenseId}/adjustments")
    ResponseEntity<AdjustmentResponse> create(@AuthenticationPrincipal CurrentPrincipal principal,
            @PathVariable UUID expenseId,
            @RequestHeader("Idempotency-Key") @Size(min = 1, max = 128) String idempotencyKey,
            @Valid @RequestBody CreateAdjustmentRequest request) {
        CreationResult result = service.create(principal, expenseId, idempotencyKey, request);
        return ResponseEntity.status(result.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(result.response());
    }

    @GetMapping("/adjustments/{adjustmentId}")
    AdjustmentResponse find(@AuthenticationPrincipal CurrentPrincipal principal,
                            @PathVariable UUID adjustmentId) {
        return service.find(principal, adjustmentId);
    }

    @PostMapping("/adjustments/{adjustmentId}/revoke")
    AdjustmentResponse revoke(@AuthenticationPrincipal CurrentPrincipal principal,
            @PathVariable UUID adjustmentId,
            @RequestHeader("Idempotency-Key") @Size(min = 1, max = 128) String idempotencyKey,
            @Valid @RequestBody RevokeAdjustmentRequest request) {
        return service.revoke(principal, adjustmentId, idempotencyKey, request);
    }
}
