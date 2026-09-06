package com.mybill.preference;

import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.mybill.preference.PreferenceContracts.PreferenceRequest;
import static com.mybill.preference.PreferenceContracts.PreferenceResponse;

@RestController
@RequestMapping("/api/v1/preferences")
public class PreferenceController {
    private final PreferenceService service;

    PreferenceController(PreferenceService service) {
        this.service = service;
    }

    @GetMapping
    PreferenceResponse get(@AuthenticationPrincipal CurrentPrincipal principal) {
        return service.get(principal);
    }

    @PutMapping
    PreferenceResponse save(@AuthenticationPrincipal CurrentPrincipal principal,
                            @Valid @RequestBody PreferenceRequest request) {
        return service.save(principal, request);
    }

    @PostMapping("/reset")
    PreferenceResponse reset(@AuthenticationPrincipal CurrentPrincipal principal) {
        return service.reset(principal);
    }
}
