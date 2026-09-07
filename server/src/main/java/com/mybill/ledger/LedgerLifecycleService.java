package com.mybill.ledger;

import com.mybill.auth.CurrentPrincipal;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.job.JobCoordinator;
import com.mybill.ledger.LedgerLifecycleContracts.LifecycleRequest;
import com.mybill.ledger.LedgerLifecycleContracts.LifecycleResponse;
import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import static com.mybill.ledger.LedgerWritePolicy.digest;
import static com.mybill.ledger.LedgerWritePolicy.validateIdempotencyKey;

/** 普通用户账目生命周期服务；每次状态变化与幂等记录在同一租户事务提交。 */
@Service
class LedgerLifecycleService {
    private final LedgerLifecycleRepository repository;
    private final TenantTransactionExecutor tenantTransactions;
    private final LedgerIdempotencyStore idempotency;
    private final JobCoordinator jobs;
    private final Clock clock;

    LedgerLifecycleService(LedgerLifecycleRepository repository, TenantTransactionExecutor tenantTransactions,
                           LedgerIdempotencyStore idempotency, JobCoordinator jobs, Clock clock) {
        this.repository = repository; this.tenantTransactions = tenantTransactions;
        this.idempotency = idempotency; this.jobs = jobs; this.clock = clock;
    }

    LifecycleResponse trashLedger(CurrentPrincipal principal, UUID id, String key, LifecycleRequest request) {
        return change(principal, id, key, request, false, "TRASH_LEDGER", "ACTIVE",
                (version, now) -> repository.trashLedger(id, version, now));
    }

    LifecycleResponse restoreLedger(CurrentPrincipal principal, UUID id, String key, LifecycleRequest request) {
        return change(principal, id, key, request, false, "RESTORE_LEDGER", "TRASHED",
                (version, now) -> repository.restoreLedger(id, version, now));
    }

    LifecycleResponse trashAdjustment(CurrentPrincipal principal, UUID id, String key, LifecycleRequest request) {
        return change(principal, id, key, request, true, "TRASH_ADJUSTMENT", "EFFECTIVE",
                (version, now) -> repository.trashAdjustment(id, version, now));
    }

    LifecycleResponse restoreAdjustment(CurrentPrincipal principal, UUID id, String key, LifecycleRequest request) {
        return change(principal, id, key, request, true, "RESTORE_ADJUSTMENT", "TRASHED",
                (version, now) -> repository.restoreAdjustment(id, version, now));
    }

    void purgeLedger(CurrentPrincipal principal, UUID id, String key, LifecycleRequest request) {
        purge(principal, id, key, request, false, "PURGE_LEDGER");
    }

    void purgeAdjustment(CurrentPrincipal principal, UUID id, String key, LifecycleRequest request) {
        purge(principal, id, key, request, true, "PURGE_ADJUSTMENT");
    }

    private LifecycleResponse change(CurrentPrincipal principal, UUID id, String requestedKey, LifecycleRequest request,
                                     boolean adjustment, String operation, String expected, Change change) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        return tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve(operation, key,
                    digest(id, request.version()), now);
            if (!reservation.replayed()) {
                LifecycleResponse current = find(id, adjustment);
                if (!expected.equals(current.lifecycleStatus()) || current.version() != request.version()
                        || !change.apply(request.version(), now)) throw conflict(expected);
                idempotency.complete(operation, key, id, now);
            }
            LifecycleResponse result = find(id, adjustment);
            if (!adjustment && "TRASHED".equals(result.lifecycleStatus()) && result.purgeAfter() != null) {
                jobs.scheduleAt(ExpiredLedgerPurgeJob.TYPE, principal.tenantId(),
                        "ledger:" + id + ":" + result.version(), result.purgeAfter());
            } else if (adjustment && "TRASHED".equals(result.lifecycleStatus()) && result.purgeAfter() != null) {
                jobs.scheduleAt(ExpiredLedgerPurgeJob.TYPE, principal.tenantId(),
                        "adjustment:" + id + ":" + result.version(), result.purgeAfter());
            }
            return result;
        });
    }

    private void purge(CurrentPrincipal principal, UUID id, String requestedKey, LifecycleRequest request,
                       boolean adjustment, String operation) {
        String key = validateIdempotencyKey(requestedKey);
        Instant now = clock.instant();
        tenantTransactions.execute(principal, () -> {
            LedgerIdempotencyStore.Reservation reservation = idempotency.reserve(operation, key,
                    digest(id, request.version()), now);
            if (reservation.replayed()) return null;
            LifecycleResponse current = find(id, adjustment);
            if (!"TRASHED".equals(current.lifecycleStatus()) || current.version() != request.version()) {
                throw conflict("TRASHED");
            }
            boolean changed = adjustment ? repository.purgeAdjustment(id, request.version())
                    : repository.purgeLedger(id, request.version());
            if (!changed) throw conflict("TRASHED");
            idempotency.complete(operation, key, id, now);
            return null;
        });
    }

    private LifecycleResponse find(UUID id, boolean adjustment) {
        return (adjustment ? repository.findAdjustment(id) : repository.findLedger(id))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "LEDGER_ENTRY_NOT_FOUND",
                        "账目不存在或不属于当前用户。", false));
    }

    private static ApiException conflict(String expected) {
        String message = "TRASHED".equals(expected)
                ? "账目状态已变化或 30 天恢复期限已结束，请刷新后重试。"
                : "账目状态已变化，请刷新后重试。";
        return new ApiException(HttpStatus.CONFLICT, "LEDGER_LIFECYCLE_CONFLICT", message, false);
    }

    @FunctionalInterface private interface Change { boolean apply(long version, Instant now); }
}
