package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.dictionary.DictionaryNameNormalizer;
import com.mybill.dictionary.IncomeDictionaryService;
import com.mybill.dictionary.IncomeDictionaryService.IncomeReferences;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import static com.mybill.ledger.IncomeContracts.*;
import static com.mybill.ledger.LedgerWritePolicy.*;

@Service
class IncomeService {
    private static final String CREATE_OPERATION = "CREATE_INCOME";
    private final IncomeRepository repository;
    private final IncomeDictionaryService dictionaries;
    private final TenantTransactionExecutor tenantTransactions;
    private final LedgerIdempotencyStore idempotency;
    private final Clock clock;

    IncomeService(IncomeRepository repository, IncomeDictionaryService dictionaries,
                  TenantTransactionExecutor tenantTransactions, LedgerIdempotencyStore idempotency, Clock clock) {
        this.repository = repository;
        this.dictionaries = dictionaries;
        this.tenantTransactions = tenantTransactions;
        this.idempotency = idempotency;
        this.clock = clock;
    }

    IncomeNames names(CurrentPrincipal principal, String query) {
        String normalized = DictionaryNameNormalizer.normalizedName(query)
                .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        return tenantTransactions.execute(principal, () -> new IncomeNames(repository.names(normalized)));
    }

    CreationResult create(CurrentPrincipal principal, String requestedKey, CreateIncomeRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        ValidatedIncome values = validate(request, now);
        String digest = requestDigest(request, values);
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve(CREATE_OPERATION, key, digest, now);
            if (reservation.replayed()) return new CreationResult(repository.find(reservation.resultId())
                    .orElseThrow(() -> new IllegalStateException("幂等结果账目不存在")), true);
            IncomeReferences refs = dictionaries.lockActiveReferences(request.payerId(), request.incomeCategoryId(),
                    request.fundingChannelId());
            validateReferences(refs);
            UUID id = UUID.randomUUID();
            repository.insert(id, request, values.incomeName(), refs, values.amount(),
                    request.occurredAt().atZone(BUSINESS_ZONE).toLocalDate(), values.note(), now);
            idempotency.complete(CREATE_OPERATION, key, id, now);
            return new CreationResult(repository.find(id).orElseThrow(), false);
        });
    }

    IncomeResponse find(CurrentPrincipal principal, UUID incomeId) {
        return tenantTransactions.execute(principal, () -> repository.find(incomeId)
                .orElseThrow(() -> notFound("收入不存在或已不在有效账目中。")));
    }

    IncomeResponse update(CurrentPrincipal principal, UUID incomeId, String requestedKey,
                          UpdateIncomeRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        CreateIncomeRequest entry = request.entry();
        ValidatedIncome values = validate(entry, now);
        String digest = LedgerWritePolicy.digest(incomeId, request.version(), requestDigest(entry, values));
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve("UPDATE_INCOME", key, digest, now);
            if (reservation.replayed()) {
                IncomeResponse replayed = repository.find(reservation.resultId())
                        .orElseThrow(() -> new IllegalStateException("幂等更新结果账目不存在"));
                if (replayed.version() != request.version() + 1) throw conflict();
                return replayed;
            }
            if (repository.find(incomeId).isEmpty()) throw notFound("收入不存在或已不在有效账目中。");
            IncomeReferences refs = dictionaries.lockActiveReferences(entry.payerId(), entry.incomeCategoryId(),
                    entry.fundingChannelId());
            validateReferences(refs);
            if (!repository.update(incomeId, request.version(), entry, values.incomeName(), refs, values.amount(),
                    entry.occurredAt().atZone(BUSINESS_ZONE).toLocalDate(), values.note(), now)) throw conflict();
            idempotency.complete("UPDATE_INCOME", key, incomeId, now);
            return repository.find(incomeId).orElseThrow();
        });
    }

    void undo(CurrentPrincipal principal, UUID incomeId, String requestedKey) {
        String key = validateIdempotencyKey(requestedKey);
        tenantTransactions.execute(principal, () -> {
            if (!repository.deleteUndoable(incomeId, key)) {
                throw new ApiException(HttpStatus.CONFLICT, "INCOME_NOT_UNDOABLE", "该收入不存在或已有后续关联，无法撤销本次保存。", false);
            }
            idempotency.deleteResult(CREATE_OPERATION, incomeId);
            return null;
        });
    }

    private ValidatedIncome validate(CreateIncomeRequest request, Instant now) {
        validateOccurredAt(request.occurredAt(), now, "收入时间");
        return new ValidatedIncome(normalizeRequired("incomeName", request.incomeName(), 200, "收入名称"),
                decimalField("amount", request.amount(), 2, new BigDecimal("999999999.99"), true),
                normalizeNote(request.note()));
    }

    private static void validateReferences(IncomeReferences refs) {
        if (refs.payer() == null) throw fieldError("payerId", "请选择启用的付款方。");
        if (refs.category() == null) throw fieldError("incomeCategoryId", "请选择启用的收入分类。");
        if (refs.fundingChannel() == null) throw fieldError("fundingChannelId", "请选择启用的收款方式。");
    }

    private static String requestDigest(CreateIncomeRequest request, ValidatedIncome values) {
        return LedgerWritePolicy.digest(values.incomeName(), request.payerId(), request.incomeCategoryId(), values.amount(),
                request.fundingChannelId(), request.occurredAt(), values.note());
    }

    private static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, "LEDGER_ENTRY_NOT_FOUND", message, false);
    }

    private static ApiException conflict() {
        return new ApiException(HttpStatus.CONFLICT, "LEDGER_VERSION_CONFLICT",
                "账目已在其他窗口发生变化，请加载最新内容或重新确认本次修改。", false);
    }

    private record ValidatedIncome(String incomeName, BigDecimal amount, String note) { }
}
