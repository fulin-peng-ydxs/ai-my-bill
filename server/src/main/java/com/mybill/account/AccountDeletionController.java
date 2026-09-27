package com.mybill.account;

import com.mybill.account.AccountDeletionContracts.DeletionResult;
import com.mybill.account.AccountDeletionContracts.SelfDeletionRequest;
import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me")
public class AccountDeletionController {
    private final AccountDeletionService service;

    AccountDeletionController(AccountDeletionService service) { this.service = service; }

    @PostMapping("/deletion")
    DeletionResult deleteSelf(@AuthenticationPrincipal CurrentPrincipal principal,
                              @Valid @RequestBody SelfDeletionRequest request) {
        return service.deleteSelf(principal, request.confirmation());
    }
}
