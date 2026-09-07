package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.ledger.ExportContracts.CreateExportRequest;
import com.mybill.ledger.ExportContracts.ExportResponse;
import jakarta.validation.Valid;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@Validated
@RestController
@RequestMapping("/api/v1/exports")
public class ExportController {
    private final ExportService service;
    ExportController(ExportService service) { this.service = service; }

    @PostMapping
    ExportResponse create(@AuthenticationPrincipal CurrentPrincipal principal,
                          @RequestHeader("Idempotency-Key") String key,
                          @Valid @RequestBody CreateExportRequest request) {
        return service.create(principal, key, request);
    }

    @GetMapping("/{id}")
    ExportResponse status(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id) {
        return service.status(principal, id);
    }

    @PostMapping("/{id}/cancel")
    ExportResponse cancel(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id) {
        return service.cancel(principal, id);
    }

    @GetMapping("/{id}/download")
    ResponseEntity<?> download(@AuthenticationPrincipal CurrentPrincipal principal, @PathVariable UUID id) {
        ExportService.Download download = service.download(principal, id);
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(download.filename(), StandardCharsets.UTF_8).build().toString())
                .body(download.resource());
    }
}
