package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

import static com.mybill.ledger.ExpenseContracts.CreateExpenseRequest;
import static com.mybill.ledger.ExpenseContracts.ExpenseResponse;
import static com.mybill.ledger.ExpenseContracts.ProductSuggestions;

@Validated
@RestController
@RequestMapping("/api/v1/expenses")
public class ExpenseController {
    private final ExpenseService service;

    ExpenseController(ExpenseService service) {
        this.service = service;
    }

    @GetMapping("/products")
    ProductSuggestions products(@AuthenticationPrincipal CurrentPrincipal principal,
                                @RequestParam(defaultValue = "") @Size(max = 200) String query) {
        return service.products(principal, query);
    }

    @PostMapping
    ResponseEntity<ExpenseResponse> create(@AuthenticationPrincipal CurrentPrincipal principal,
                                           @RequestHeader("Idempotency-Key") String idempotencyKey,
                                           @Valid @RequestBody CreateExpenseRequest request) {
        ExpenseContracts.CreationResult result = service.create(principal, idempotencyKey, request);
        return ResponseEntity.status(result.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(result.response());
    }

    @DeleteMapping("/{expenseId}/undo")
    ResponseEntity<Void> undo(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID expenseId,
                              @RequestHeader("Idempotency-Key") String idempotencyKey) {
        service.undo(principal, expenseId, idempotencyKey);
        return ResponseEntity.noContent().build();
    }
}
