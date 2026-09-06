package com.mybill.dictionary;

import com.mybill.auth.CurrentPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

import static com.mybill.dictionary.ProductMergeContracts.MergePreview;
import static com.mybill.dictionary.ProductMergeContracts.MergeRequest;
import static com.mybill.dictionary.ProductMergeContracts.MergeResult;

@RestController
@RequestMapping("/api/v1/dictionaries/product/{sourceProductId}")
public class ProductMergeController {
    private final ProductMergeService service;

    ProductMergeController(ProductMergeService service) {
        this.service = service;
    }

    @GetMapping("/merge-preview")
    MergePreview preview(@AuthenticationPrincipal CurrentPrincipal principal,
                         @PathVariable UUID sourceProductId, @RequestParam UUID targetProductId) {
        return service.preview(principal, sourceProductId, targetProductId);
    }

    @PostMapping("/merge")
    MergeResult merge(@AuthenticationPrincipal CurrentPrincipal principal,
                      @PathVariable UUID sourceProductId, @Valid @RequestBody MergeRequest request) {
        return service.merge(principal, sourceProductId, request.targetProductId());
    }
}
