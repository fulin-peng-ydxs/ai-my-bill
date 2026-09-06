package com.mybill.job;

import com.mybill.shared.persistence.TenantDatabaseExecutor;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/** 单进程或多进程均可安全调用的小批次任务协调器；调度触发由后续业务阶段接入。 */
@Service
public final class JobCoordinator {
    private final JobRunRepository repository;
    private final JobDefinitionRegistry registry;
    private final TenantDatabaseExecutor tenantTransactions;
    private final TransactionTemplate globalTransactions;
    private final MeterRegistry meters;
    private final JobRunnerProperties properties;
    private final Clock clock;
    private final String owner;

    @Autowired
    public JobCoordinator(JobRunRepository repository, JobDefinitionRegistry registry,
                          TenantDatabaseExecutor tenantTransactions, PlatformTransactionManager manager,
                          MeterRegistry meters, JobRunnerProperties properties) {
        this(repository, registry, tenantTransactions, new TransactionTemplate(manager), meters, properties,
                Clock.systemUTC(), UUID.randomUUID().toString());
    }

    JobCoordinator(JobRunRepository repository, JobDefinitionRegistry registry,
                   TenantDatabaseExecutor tenantTransactions, TransactionTemplate globalTransactions,
                   MeterRegistry meters, JobRunnerProperties properties, Clock clock, String owner) {
        this.repository = repository; this.registry = registry; this.tenantTransactions = tenantTransactions;
        this.globalTransactions = globalTransactions; this.meters = meters; this.properties = properties;
        this.clock = clock; this.owner = owner;
    }

    public UUID schedule(String type, UUID tenantId, String batchKey) {
        JobDefinition definition = registry.require(type);
        enforceScope(definition, tenantId);
        return repository.schedule(type, tenantId, batchKey, definition.maxAttempts(), Instant.now(clock));
    }

    public boolean runNext() {
        recoverExpired();
        Instant now = Instant.now(clock);
        return repository.claimNext(registry.types(), owner, now, now.plus(properties.leaseDuration()))
                .map(run -> { execute(run); return true; }).orElse(false);
    }

    public String requestCancellation(UUID runId) {
        JobRun run = repository.find(runId).orElseThrow(() -> new IllegalArgumentException("job run not found"));
        return repository.requestCancellation(runId, registry.require(run.jobType()).cancellable(), Instant.now(clock));
    }

    public int recoverExpired() {
        Instant now = Instant.now(clock);
        int recovered = 0;
        for (JobRun run : repository.findExpired(now)) {
            JobDefinition definition = registry.find(run.jobType());
            boolean retry = definition != null && definition.retryable() && run.attemptCount() < run.maxAttempts();
            if (repository.recoverExpired(run.id(), retry,
                    definition == null ? "UNKNOWN_JOB_TYPE" : "LEASE_EXPIRED", now)) {
                meters.counter("my_bill.jobs.recovered", "job_type", run.jobType(),
                        "outcome", retry ? "retry" : "failed").increment();
                recovered++;
            }
        }
        return recovered;
    }

    private void execute(JobRun run) {
        JobDefinition definition = registry.require(run.jobType());
        try {
            enforceScope(definition, run.tenantId());
            JobBatchResult result = inScopeTransaction(definition, run, () -> definition.executeBatch(context(run)));
            boolean cancelled = definition.cancellable() && repository.isCancellationRequested(run.id(), owner);
            Instant now = Instant.now(clock);
            if (cancelled) repository.cancel(run.id(), owner, result.processedCount(), now);
            else if (result.completed()) repository.complete(run.id(), owner, result.processedCount(), now);
            else repository.releaseForMore(run.id(), owner, result.processedCount(), now);
            meters.counter("my_bill.jobs.executed", "job_type", run.jobType(), "outcome",
                    cancelled ? "cancelled" : result.completed() ? "succeeded" : "continued").increment();
        } catch (JobLeaseLostException leaseLost) {
            recordLeaseLost(run);
        } catch (Exception failure) {
            boolean retry = definition.retryable() && run.attemptCount() < run.maxAttempts();
            try {
                repository.failOrRetry(run.id(), owner, retry, safeError(failure), Instant.now(clock));
            } catch (JobLeaseLostException leaseLost) {
                recordLeaseLost(run);
                return;
            }
            meters.counter("my_bill.jobs.executed", "job_type", run.jobType(),
                    "outcome", retry ? "retry" : "failed").increment();
        }
    }

    private void recordLeaseLost(JobRun run) {
        meters.counter("my_bill.jobs.executed", "job_type", run.jobType(), "outcome", "lease_lost").increment();
    }

    private JobExecutionContext context(JobRun run) {
        return new JobExecutionContext(run.id(), run.tenantId(), run.batchKey(),
                () -> repository.isCancellationRequested(run.id(), owner), () -> {
                    Instant now = Instant.now(clock);
                    if (!repository.renew(run.id(), owner, now, now.plus(properties.leaseDuration()))) {
                        throw new IllegalStateException("任务租约已失效");
                    }
                });
    }

    private <T> T inScopeTransaction(JobDefinition definition, JobRun run, ThrowingSupplier<T> work) {
        if (definition.scope() == JobScope.TENANT) {
            return tenantTransactions.execute(run.tenantId(), () -> unchecked(work));
        }
        return globalTransactions.execute(status -> unchecked(work));
    }

    private static <T> T unchecked(ThrowingSupplier<T> work) {
        try { return work.get(); }
        catch (RuntimeException runtime) { throw runtime; }
        catch (Exception checked) { throw new JobExecutionException(checked); }
    }

    private static String safeError(Exception failure) {
        Throwable cause = failure instanceof JobExecutionException && failure.getCause() != null ? failure.getCause() : failure;
        String name = cause.getClass().getSimpleName();
        return name.length() <= 200 ? name : "JOB_EXECUTION_FAILED";
    }

    private static void enforceScope(JobDefinition definition, UUID tenantId) {
        if ((definition.scope() == JobScope.TENANT) != (tenantId != null)) {
            throw new IllegalArgumentException("job scope and tenant do not match");
        }
    }

    @FunctionalInterface private interface ThrowingSupplier<T> { T get() throws Exception; }
    private static final class JobExecutionException extends RuntimeException {
        JobExecutionException(Throwable cause) { super(cause); }
    }
}
