package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

import static com.mybill.ledger.IncomeContracts.*;

@Validated
@RestController
@RequestMapping("/api/v1/incomes")
public class IncomeController {
    private final IncomeService service;
    IncomeController(IncomeService service) { this.service = service; }

    @GetMapping("/names")
    IncomeNames names(@AuthenticationPrincipal CurrentPrincipal principal,
                      @RequestParam(defaultValue = "") @Size(max = 200) String query) {
        return service.names(principal, query);
    }

    @PostMapping
    ResponseEntity<IncomeResponse> create(@AuthenticationPrincipal CurrentPrincipal principal,
            @RequestHeader("Idempotency-Key") String key, @Valid @RequestBody CreateIncomeRequest request) {
        CreationResult result = service.create(principal, key, request);
        return ResponseEntity.status(result.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(result.response());
    }

    @GetMapping("/{incomeId}")
    IncomeResponse find(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID incomeId) {
        return service.find(principal, incomeId);
    }

    @PutMapping("/{incomeId}")
    IncomeResponse update(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID incomeId,
                          @RequestHeader("Idempotency-Key") String key,
                          @Valid @RequestBody UpdateIncomeRequest request) {
        return service.update(principal, incomeId, key, request);
    }

    @DeleteMapping("/{incomeId}/undo")
    ResponseEntity<Void> undo(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID incomeId,
                              @RequestHeader("Idempotency-Key") String key) {
        service.undo(principal, incomeId, key);
        return ResponseEntity.noContent().build();
    }
}
