package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.ledger.ExpenseAdjustmentContracts.AdjustmentResponse;
import com.mybill.ledger.ExpenseAdjustmentContracts.CreateAdjustmentRequest;
import com.mybill.ledger.ExpenseAdjustmentContracts.CreationResult;
import com.mybill.ledger.ExpenseAdjustmentContracts.RevokeAdjustmentRequest;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.mybill.ledger.LedgerWritePolicy.*;

@Service
class ExpenseAdjustmentService {
    private static final String CREATE_OPERATION = "CREATE_EXPENSE_ADJUSTMENT";
    private static final String REVOKE_OPERATION = "REVOKE_EXPENSE_ADJUSTMENT";
    private static final BigDecimal MONEY_MAXIMUM = new BigDecimal("999999999.99");
    private final ExpenseAdjustmentRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final LedgerIdempotencyStore idempotency;
    private final Clock clock;

    ExpenseAdjustmentService(ExpenseAdjustmentRepository repository, TenantTransactionExecutor tenantTransactions,
                             LedgerIdempotencyStore idempotency, Clock clock) {
        this.repository = repository; this.tenantTransactions = tenantTransactions;
        this.idempotency = idempotency; this.clock = clock;
    }

    CreationResult create(CurrentPrincipal principal, UUID expenseId, String requestedKey,
                          CreateAdjustmentRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        validateOccurredAt(request.occurredAt(), now, "调整时间");
        BigDecimal amount = decimalField("amount", request.amount(), 2, MONEY_MAXIMUM, true);
        String note = normalizeNote(request.note());
        String digest = digest(expenseId, request.adjustmentType(), amount, request.occurredAt(), note);
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve(CREATE_OPERATION, key, digest, now);
            if (reservation.replayed()) return new CreationResult(repository.find(reservation.resultId())
                    .orElseThrow(() -> new IllegalStateException("幂等调整结果不存在")), true);
            ExpenseAdjustmentRepository.SourceExpense source = repository.lockActiveExpense(expenseId)
                    .orElseThrow(() -> notFound("只能从当前有效支出创建退款或报销调整。"));
            BigDecimal current = repository.effectiveTotal(source.id());
            if (current.add(amount).compareTo(source.paidAmount()) > 0) {
                String remaining = source.paidAmount().subtract(current).max(BigDecimal.ZERO).setScale(2).toPlainString();
                throw new ApiException(HttpStatus.CONFLICT, "ADJUSTMENT_EXCEEDS_EXPENSE",
                        "调整累计金额不能超过原支出实付金额。", false,
                        Map.of("amount", List.of("当前最多还可调整 ¥" + remaining + "。")));
            }
            UUID id = UUID.randomUUID();
            repository.insert(id, source.id(), request.adjustmentType(), amount, request,
                    request.occurredAt().atZone(BUSINESS_ZONE).toLocalDate(), note, now);
            idempotency.complete(CREATE_OPERATION, key, id, now);
            return new CreationResult(repository.find(id).orElseThrow(), false);
        });
    }

    AdjustmentResponse find(CurrentPrincipal principal, UUID adjustmentId) {
        return tenantTransactions.execute(principal, () -> repository.find(adjustmentId)
                .orElseThrow(() -> notFound("调整不存在或已不在可查看状态。")));
    }

    AdjustmentResponse revoke(CurrentPrincipal principal, UUID adjustmentId, String requestedKey,
                              RevokeAdjustmentRequest request) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        String digest = digest(adjustmentId, request.version());
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve(REVOKE_OPERATION, key, digest, now);
            if (reservation.replayed()) return repository.find(reservation.resultId())
                    .orElseThrow(() -> new IllegalStateException("幂等撤销结果不存在"));
            AdjustmentResponse current = repository.find(adjustmentId)
                    .orElseThrow(() -> notFound("调整不存在或已不在可查看状态。"));
            if (!"EFFECTIVE".equals(current.status()) || current.version() != request.version()) {
                throw new ApiException(HttpStatus.CONFLICT, "ADJUSTMENT_CHANGED",
                        "调整状态已变化，请刷新后重试。", false);
            }
            if (!repository.revoke(adjustmentId, request.version(), now)) {
                throw new ApiException(HttpStatus.CONFLICT, "ADJUSTMENT_CHANGED",
                        "调整状态已变化，请刷新后重试。", false);
            }
            idempotency.complete(REVOKE_OPERATION, key, adjustmentId, now);
            return repository.find(adjustmentId).orElseThrow();
        });
    }

    private static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", message, false);
    }
}
