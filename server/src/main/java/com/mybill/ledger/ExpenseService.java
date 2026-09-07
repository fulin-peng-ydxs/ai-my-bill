package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.dictionary.ExpenseDictionaryService;
import com.mybill.dictionary.ExpenseDictionaryService.ExpenseReferences;
import com.mybill.dictionary.DictionaryNameNormalizer;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import static com.mybill.ledger.LedgerWritePolicy.BUSINESS_ZONE;
import static com.mybill.ledger.LedgerWritePolicy.decimal;
import static com.mybill.ledger.LedgerWritePolicy.decimalField;
import static com.mybill.ledger.LedgerWritePolicy.fieldError;
import static com.mybill.ledger.LedgerWritePolicy.normalizeNote;
import static com.mybill.ledger.LedgerWritePolicy.validateIdempotencyKey;
import static com.mybill.ledger.LedgerWritePolicy.validateOccurredAt;

import static com.mybill.ledger.ExpenseContracts.CreationResult;
import static com.mybill.ledger.ExpenseContracts.CreateExpenseRequest;
import static com.mybill.ledger.ExpenseContracts.ProductSuggestion;
import static com.mybill.ledger.ExpenseContracts.ProductSuggestions;
import static com.mybill.ledger.ExpenseContracts.ExpenseResponse;
import static com.mybill.ledger.ExpenseContracts.UpdateExpenseRequest;

/** 支出填报应用服务；引用校验、幂等、账目和商品最近值在一个租户事务内提交。 */
@Service
class ExpenseService {
    private static final String CREATE_OPERATION = "CREATE_EXPENSE";
    private final ExpenseRepository repository;
    private final ExpenseDictionaryService dictionaries;
    private final TenantTransactionExecutor tenantTransactions;
    private final LedgerIdempotencyStore idempotency;
    private final Clock clock;

    ExpenseService(ExpenseRepository repository, ExpenseDictionaryService dictionaries,
                   TenantTransactionExecutor tenantTransactions, LedgerIdempotencyStore idempotency, Clock clock) {
        this.repository = repository;
        this.dictionaries = dictionaries;
        this.tenantTransactions = tenantTransactions;
        this.idempotency = idempotency;
        this.clock = clock;
    }

    ProductSuggestions products(CurrentPrincipal principal, String query) {
        String normalized = escapeLike(DictionaryNameNormalizer.normalizedName(query));
        return tenantTransactions.execute(principal, () -> new ProductSuggestions(
                dictionaries.listActiveProducts(normalized, 20).stream().map(value -> new ProductSuggestion(
                        value.id(), value.name(), value.primaryCategoryId(), value.primaryCategoryName(),
                        value.secondaryCategoryId(), value.secondaryCategoryName(), value.unitId(), value.unitName(),
                        value.lastUnitPrice() == null ? null : decimal(value.lastUnitPrice()),
                        value.fundingChannelId(), value.fundingChannelName(),
                        value.purchaseChannelId(), value.purchaseChannelName())).toList()));
    }

    CreationResult create(CurrentPrincipal principal, String requestedKey, CreateExpenseRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        ValidatedExpense values = validate(request, now);
        String digest = requestDigest(request, values.unitPrice(), values.quantity(), values.paidAmount(), values.note());
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve(CREATE_OPERATION, key, digest, now);
            if (reservation.replayed()) return new CreationResult(repository.findExpense(reservation.resultId())
                    .orElseThrow(() -> new IllegalStateException("幂等结果账目不存在")), true);

            ExpenseReferences references = dictionaries.lockActiveReferences(request.productId(),
                    request.primaryCategoryId(), request.secondaryCategoryId(), request.unitId(),
                    request.fundingChannelId(), request.purchaseChannelId(), request.locationLabelId());
            validateReferences(request, references);
            UUID id = UUID.randomUUID();
            repository.insertExpense(id, request, references, values.unitPrice(), values.quantity(), values.paidAmount(),
                    values.calculated(), request.occurredAt().atZone(BUSINESS_ZONE).toLocalDate(), values.note(), now);
            dictionaries.updateProductRecentValues(request.productId(), request.primaryCategoryId(),
                    request.secondaryCategoryId(), request.unitId(), values.unitPrice(), values.quantity(),
                    request.fundingChannelId(), request.purchaseChannelId(), now);
            idempotency.complete(CREATE_OPERATION, key, id, now);
            return new CreationResult(repository.findExpense(id).orElseThrow(), false);
        });
    }

    ExpenseResponse find(CurrentPrincipal principal, UUID expenseId) {
        return tenantTransactions.execute(principal, () -> repository.findExpense(expenseId)
                .orElseThrow(() -> notFound("支出不存在或已不在有效账目中。")));
    }

    ExpenseResponse update(CurrentPrincipal principal, UUID expenseId, String requestedKey,
                           UpdateExpenseRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        CreateExpenseRequest entry = request.entry();
        ValidatedExpense values = validate(entry, now);
        String digest = LedgerWritePolicy.digest(expenseId, request.version(),
                requestDigest(entry, values.unitPrice(), values.quantity(), values.paidAmount(), values.note()));
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve("UPDATE_EXPENSE", key, digest, now);
            if (reservation.replayed()) {
                ExpenseResponse replayed = repository.findExpense(reservation.resultId())
                        .orElseThrow(() -> new IllegalStateException("幂等更新结果账目不存在"));
                if (replayed.version() != request.version() + 1) throw conflict();
                return replayed;
            }
            ExpenseResponse current = repository.findExpense(expenseId)
                    .orElseThrow(() -> notFound("支出不存在或已不在有效账目中。"));
            ExpenseReferences references = dictionaries.lockActiveReferences(entry.productId(),
                    entry.primaryCategoryId(), entry.secondaryCategoryId(), entry.unitId(),
                    entry.fundingChannelId(), entry.purchaseChannelId(), entry.locationLabelId());
            validateReferences(entry, references);
            boolean updated = repository.updateExpense(expenseId, request.version(), entry, references,
                    values.unitPrice(), values.quantity(), values.paidAmount(), values.calculated(),
                    entry.occurredAt().atZone(BUSINESS_ZONE).toLocalDate(), values.note(), now);
            if (!updated) throw conflict();
            dictionaries.updateProductRecentValues(entry.productId(), entry.primaryCategoryId(),
                    entry.secondaryCategoryId(), entry.unitId(), values.unitPrice(), values.quantity(),
                    entry.fundingChannelId(), entry.purchaseChannelId(), now);
            if (!current.productId().equals(entry.productId())) {
                dictionaries.refreshProductRecentValues(current.productId(), now);
            }
            idempotency.complete("UPDATE_EXPENSE", key, expenseId, now);
            return repository.findExpense(expenseId).orElseThrow();
        });
    }

    void undo(CurrentPrincipal principal, UUID expenseId, String requestedKey) {
        String key = validateIdempotencyKey(requestedKey);
        tenantTransactions.execute(principal, () -> {
            UUID productId = repository.deleteUndoableExpense(expenseId, key)
                    .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "EXPENSE_NOT_UNDOABLE",
                            "该支出不存在或已有后续关联，无法撤销本次保存。", false));
            idempotency.deleteResult(CREATE_OPERATION, expenseId);
            dictionaries.refreshProductRecentValues(productId, clock.instant());
            return null;
        });
    }

    private void validateReferences(CreateExpenseRequest request, ExpenseReferences references) {
        if (references.product() == null) throw fieldError("productId", "请选择当前可用的商品。");
        if (references.primaryCategory() == null) throw fieldError("primaryCategoryId", "请选择启用的一级分类。");
        if (request.secondaryCategoryId() != null && references.secondaryCategory() == null) {
            throw fieldError("secondaryCategoryId", "请选择属于该一级分类的启用二级分类。");
        }
        if (references.unit() == null) throw fieldError("unitId", "请选择启用的单位。");
        if (references.fundingChannel() == null) throw fieldError("fundingChannelId", "请选择启用的支付方式。");
        if (request.purchaseChannelId() != null && references.purchaseChannel() == null) {
            throw fieldError("purchaseChannelId", "请选择启用的购买渠道。");
        }
        if (request.locationLabelId() != null && references.locationLabel() == null) {
            throw fieldError("locationLabelId", "请选择启用的地点标签。");
        }
    }

    private String requestDigest(CreateExpenseRequest request, BigDecimal unitPrice, BigDecimal quantity,
                                 BigDecimal paidAmount, String note) {
        return LedgerWritePolicy.digest(request.productId(), request.primaryCategoryId(), request.secondaryCategoryId(), request.unitId(),
                unitPrice, quantity, paidAmount, request.fundingChannelId(), request.purchaseChannelId(),
                request.locationLabelId(), request.occurredAt(), note);
    }

    private ValidatedExpense validate(CreateExpenseRequest request, Instant now) {
        validateOccurredAt(request.occurredAt(), now, "消费时间");
        String note = normalizeNote(request.note());
        BigDecimal unitPrice = decimalField("unitPrice", request.unitPrice(), 4,
                new BigDecimal("99999999.9999"), false);
        BigDecimal quantity = decimalField("quantity", request.quantity(), 3,
                new BigDecimal("999999.999"), true);
        BigDecimal paidAmount = decimalField("paidAmount", request.paidAmount(), 2,
                new BigDecimal("999999999.99"), false);
        BigDecimal calculated = unitPrice.multiply(quantity).setScale(2, RoundingMode.HALF_UP);
        if (calculated.compareTo(new BigDecimal("999999999.99")) > 0) {
            throw fieldError("calculatedAmount", "计算金额超出允许范围。");
        }
        return new ValidatedExpense(unitPrice, quantity, paidAmount, calculated, note);
    }

    private static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, "LEDGER_ENTRY_NOT_FOUND", message, false);
    }

    private static ApiException conflict() {
        return new ApiException(HttpStatus.CONFLICT, "LEDGER_VERSION_CONFLICT",
                "账目已在其他窗口发生变化，请加载最新内容或重新确认本次修改。", false);
    }

    private record ValidatedExpense(BigDecimal unitPrice, BigDecimal quantity, BigDecimal paidAmount,
                                    BigDecimal calculated, String note) { }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
