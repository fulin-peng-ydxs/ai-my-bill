package com.mybill.admin.dictionary;

import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

import static com.mybill.admin.dictionary.DefaultDictionaryContracts.CreateRequest;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.DefaultDictionaryItem;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.DefaultDictionaryPage;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.DefaultDictionarySummaries;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.MoveRequest;
import static com.mybill.admin.dictionary.DefaultDictionaryContracts.StatusRequest;

@Validated
@RestController
@RequestMapping("/api/v1/admin/default-dictionaries")
public class DefaultDictionaryController {
    private final DefaultDictionaryService service;

    DefaultDictionaryController(DefaultDictionaryService service) {
        this.service = service;
    }

    @GetMapping
    DefaultDictionarySummaries summaries() {
        return service.summaries();
    }

    @GetMapping("/{type}")
    DefaultDictionaryPage list(@PathVariable String type,
                               @RequestParam(defaultValue = "") @Size(max = 64) String query,
                               @RequestParam(required = false) DefaultDictionaryStatus status,
                               @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
                               @RequestParam(defaultValue = "50") @Min(1) @Max(100) int size) {
        return service.list(DefaultDictionaryType.fromSlug(type), query, status, page, size);
    }

    @PostMapping("/{type}")
    DefaultDictionaryItem create(@AuthenticationPrincipal CurrentPrincipal administrator, @PathVariable String type,
                                 @Valid @RequestBody CreateRequest request) {
        return service.create(administrator, DefaultDictionaryType.fromSlug(type), request.name(), request.parentId());
    }

    @PostMapping("/{type}/{itemId}/status")
    DefaultDictionaryItem changeStatus(@AuthenticationPrincipal CurrentPrincipal administrator,
                                       @PathVariable String type, @PathVariable UUID itemId,
                                       @Valid @RequestBody StatusRequest request) {
        return service.changeStatus(administrator, DefaultDictionaryType.fromSlug(type), itemId, request.status());
    }

    @PostMapping("/{type}/{itemId}/move")
    DefaultDictionaryItem move(@AuthenticationPrincipal CurrentPrincipal administrator,
                               @PathVariable String type, @PathVariable UUID itemId,
                               @Valid @RequestBody MoveRequest request) {
        return service.move(administrator, DefaultDictionaryType.fromSlug(type), itemId, request.direction(), request.targetId());
    }
}
