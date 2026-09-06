package com.mybill.dictionary;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import static com.mybill.dictionary.ProductMergeContracts.MergePreview;
import static com.mybill.dictionary.ProductMergeContracts.MergeResult;
import static com.mybill.dictionary.ProductMergeContracts.ProductIdentity;

/** 商品影响预览与原子合并；确认时重新锁定并计算影响，预览不会被当作写入依据。 */
@Service
class ProductMergeService {
    private final ProductMergeRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final Clock clock;

    ProductMergeService(ProductMergeRepository repository, TenantTransactionExecutor tenantTransactions, Clock clock) {
        this.repository = repository;
        this.tenantTransactions = tenantTransactions;
        this.clock = clock;
    }

    MergePreview preview(CurrentPrincipal principal, UUID sourceId, UUID targetId) {
        return tenantTransactions.execute(principal, () -> impact(resolvePair(sourceId, targetId, false)));
    }

    MergeResult merge(CurrentPrincipal principal, UUID sourceId, UUID targetId) {
        return tenantTransactions.execute(principal, () -> {
            ProductPair pair = resolvePair(sourceId, targetId, true);
            MergePreview preview = impact(pair);
            Instant now = clock.instant();
            var sourceTemplate = repository.findTemplate(sourceId);
            var targetTemplate = repository.findTemplate(targetId);

            if (sourceTemplate.isPresent() && targetTemplate.isPresent()) {
                ProductMergeRepository.TemplateRow source = sourceTemplate.orElseThrow();
                ProductMergeRepository.TemplateRow target = targetTemplate.orElseThrow();
                boolean sourceIsNewer = Comparator.comparing(ProductMergeRepository.TemplateRow::lastUsedAt)
                        .thenComparing(ProductMergeRepository.TemplateRow::updatedAt)
                        .thenComparing(ProductMergeRepository.TemplateRow::id)
                        .compare(source, target) > 0;
                if (sourceIsNewer) repository.copyTemplatePayload(source.id(), target.id(), pair.target(), now);
                else repository.refreshRetainedTemplate(target.id(), pair.target(), now);
                repository.deleteTemplate(source.id());
            } else if (sourceTemplate.isPresent()) {
                repository.moveTemplate(sourceTemplate.orElseThrow().id(), pair.target(), now);
            }

            int updatedLedgerEntries = repository.updateLedgerProduct(sourceId, targetId);
            if (updatedLedgerEntries != preview.affectedLedgerEntries()) {
                throw conflict("商品引用已发生变化，请刷新影响预览后重试。");
            }
            repository.repointPreviousMerges(sourceId, targetId, now);
            repository.markMerged(sourceId, targetId, now);
            UUID eventId = UUID.randomUUID();
            repository.insertEvent(eventId, sourceId, targetId, principal.userId(),
                    preview.affectedLedgerEntries(), preview.affectedTemplates(), preview.templateConflict(), now);
            return new MergeResult(eventId, preview);
        });
    }

    private ProductPair resolvePair(UUID sourceId, UUID targetId, boolean lock) {
        if (sourceId.equals(targetId)) throw invalidTarget("不能将商品合并到自身。");
        List<ProductMergeRepository.ProductRow> rows = lock
                ? repository.lockProducts(sourceId, targetId)
                : java.util.stream.Stream.of(repository.findProduct(sourceId), repository.findProduct(targetId))
                    .flatMap(java.util.Optional::stream).toList();
        ProductMergeRepository.ProductRow source = rows.stream().filter(row -> row.id().equals(sourceId))
                .findFirst().orElseThrow(ProductMergeService::notFound);
        ProductMergeRepository.ProductRow target = rows.stream().filter(row -> row.id().equals(targetId))
                .findFirst().orElseThrow(ProductMergeService::notFound);
        if ("MERGED".equals(source.status())) throw conflict("源商品已经被合并，请刷新后重试。");
        if (!"ACTIVE".equals(target.status())) throw invalidTarget("只能合并到启用中的商品。");
        return new ProductPair(source, target);
    }

    private MergePreview impact(ProductPair pair) {
        long ledgerCount = repository.countLedgerEntries(pair.source().id());
        boolean sourceTemplate = repository.findTemplate(pair.source().id()).isPresent();
        boolean targetTemplate = repository.findTemplate(pair.target().id()).isPresent();
        return new MergePreview(identity(pair.source()), identity(pair.target()), ledgerCount,
                sourceTemplate ? 1 : 0, sourceTemplate && targetTemplate);
    }

    private ProductIdentity identity(ProductMergeRepository.ProductRow row) {
        return new ProductIdentity(row.id(), row.displayName());
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "商品不存在。", false);
    }

    private static ApiException invalidTarget(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "PRODUCT_MERGE_TARGET_INVALID", message, false);
    }

    private static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, "PRODUCT_MERGE_CONFLICT", message, false);
    }

    private record ProductPair(ProductMergeRepository.ProductRow source,
                               ProductMergeRepository.ProductRow target) { }
}
