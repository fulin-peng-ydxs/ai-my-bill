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
        validateOccurredAt(request.occurredAt(), now, "收入时间");
        String incomeName = normalizeRequired("incomeName", request.incomeName(), 200, "收入名称");
        String note = normalizeNote(request.note());
        BigDecimal amount = decimalField("amount", request.amount(), 2, new BigDecimal("999999999.99"), true);
        String digest = LedgerWritePolicy.digest(incomeName, request.payerId(), request.incomeCategoryId(), amount,
                request.fundingChannelId(), request.occurredAt(), note);
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve(CREATE_OPERATION, key, digest, now);
            if (reservation.replayed()) return new CreationResult(repository.find(reservation.resultId())
                    .orElseThrow(() -> new IllegalStateException("幂等结果账目不存在")), true);
            IncomeReferences refs = dictionaries.lockActiveReferences(request.payerId(), request.incomeCategoryId(),
                    request.fundingChannelId());
            if (refs.payer() == null) throw fieldError("payerId", "请选择启用的付款方。");
            if (refs.category() == null) throw fieldError("incomeCategoryId", "请选择启用的收入分类。");
            if (refs.fundingChannel() == null) throw fieldError("fundingChannelId", "请选择启用的收款方式。");
            UUID id = UUID.randomUUID();
            repository.insert(id, request, incomeName, refs, amount,
                    request.occurredAt().atZone(BUSINESS_ZONE).toLocalDate(), note, now);
            idempotency.complete(CREATE_OPERATION, key, id, now);
            return new CreationResult(repository.find(id).orElseThrow(), false);
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
}
