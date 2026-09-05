package com.mybill.dictionary;

import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

import static com.mybill.dictionary.DictionaryContracts.CreateRequest;
import static com.mybill.dictionary.DictionaryContracts.DictionaryItem;
import static com.mybill.dictionary.DictionaryContracts.DictionaryPage;
import static com.mybill.dictionary.DictionaryContracts.DictionarySummaries;
import static com.mybill.dictionary.DictionaryContracts.MoveRequest;
import static com.mybill.dictionary.DictionaryContracts.RenameRequest;
import static com.mybill.dictionary.DictionaryContracts.StatusRequest;

@Validated
@RestController
@RequestMapping("/api/v1/dictionaries")
public class PersonalDictionaryController {
    private final PersonalDictionaryService service;

    PersonalDictionaryController(PersonalDictionaryService service) {
        this.service = service;
    }

    @GetMapping
    DictionarySummaries summaries(@AuthenticationPrincipal CurrentPrincipal principal) {
        return service.summaries(principal);
    }

    @GetMapping("/{type}")
    DictionaryPage list(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable String type,
                        @RequestParam(defaultValue = "") @Size(max = 64) String query,
                        @RequestParam(required = false) DictionaryStatus status,
                        @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
                        @RequestParam(defaultValue = "50") @Min(1) @Max(100) int size) {
        return service.list(principal, DictionaryType.fromSlug(type), query, status, page, size, false);
    }

    @GetMapping("/{type}/candidates")
    DictionaryPage candidates(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable String type,
                              @RequestParam(defaultValue = "") @Size(max = 64) String query,
                              @RequestParam(defaultValue = "20") @Min(1) @Max(50) int limit) {
        return service.list(principal, DictionaryType.fromSlug(type), query, DictionaryStatus.ACTIVE, 0, limit, true);
    }

    @PostMapping("/{type}")
    DictionaryItem create(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable String type,
                          @Valid @RequestBody CreateRequest request) {
        return service.create(principal, DictionaryType.fromSlug(type), request.name(), request.parentId());
    }

    @PatchMapping("/{type}/{itemId}")
    DictionaryItem rename(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable String type,
                          @PathVariable UUID itemId, @Valid @RequestBody RenameRequest request) {
        return service.rename(principal, DictionaryType.fromSlug(type), itemId, request.name());
    }

    @PostMapping("/{type}/{itemId}/status")
    DictionaryItem changeStatus(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable String type,
                                @PathVariable UUID itemId, @Valid @RequestBody StatusRequest request) {
        return service.changeStatus(principal, DictionaryType.fromSlug(type), itemId, request.status());
    }

    @PostMapping("/{type}/{itemId}/move")
    DictionaryItem move(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable String type,
                        @PathVariable UUID itemId, @Valid @RequestBody MoveRequest request) {
        return service.move(principal, DictionaryType.fromSlug(type), itemId, request.direction());
    }
}
