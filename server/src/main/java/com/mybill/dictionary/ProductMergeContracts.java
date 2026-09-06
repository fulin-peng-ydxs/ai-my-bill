package com.mybill.dictionary;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

final class ProductMergeContracts {
    private ProductMergeContracts() { }

    record MergeRequest(@NotNull UUID targetProductId) { }

    record ProductIdentity(UUID id, String name) { }

    record MergePreview(ProductIdentity source, ProductIdentity target, long affectedLedgerEntries,
                        int affectedTemplates, boolean templateConflict) { }

    record MergeResult(UUID mergeEventId, MergePreview impact) { }
}
