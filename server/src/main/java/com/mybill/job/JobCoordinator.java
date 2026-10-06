package com.mybill.job;

import com.mybill.shared.persistence.TenantDatabaseExecutor;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 单进程或多进程均可安全调用的小批次任务协调器；调度触发由后续业务阶段接入。 */
@Service
public final class JobCoordinator {
    private static final Logger LOG = LoggerFactory.getLogger(JobCoordinator.class);
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
                          MeterRegistry meters, JobRunnerProperties properties, Clock clock) {
        this(repository, registry, tenantTransactions, new TransactionTemplate(manager), meters, properties,
                clock, UUID.randomUUID().toString());
    }

    JobCoordinator(JobRunRepository repository, JobDefinitionRegistry registry,
                   TenantDatabaseExecutor tenantTransactions, TransactionTemplate globalTransactions,
                   MeterRegistry meters, JobRunnerProperties properties, Clock clock, String owner) {
        this.repository = repository; this.registry = registry; this.tenantTransactions = tenantTransactions;
        this.globalTransactions = globalTransactions; this.meters = meters; this.properties = properties;
        this.clock = clock; this.owner = owner;
    }

    public UUID schedule(String type, UUID tenantId, String batchKey) {
        return scheduleAt(type, tenantId, batchKey, Instant.now(clock));
    }

    /** 注册一个到指定时刻才可领取的任务，业务键保证重复调度返回同一任务。 */
    public UUID scheduleAt(String type, UUID tenantId, String batchKey, Instant availableAt) {
        JobDefinition definition = registry.require(type);
        enforceScope(definition, tenantId);
        return repository.schedule(type, tenantId, batchKey, definition.maxAttempts(), availableAt, Instant.now(clock));
    }

    public boolean runNext() {
        recoverExpired();
        return claimAndRun(registry.types());
    }

    /** 每轮每种任务至多领取一个，并在上限内循环，兼顾吞吐和任务类型公平性。 */
    public int runAvailable(int maximum) {
        if (maximum < 1) throw new IllegalArgumentException("maximum must be positive");
        recoverExpired();
        List<String> types = List.copyOf(registry.types());
        int executed = 0;
        boolean progressed;
        do {
            progressed = false;
            for (String type : types) {
                if (executed == maximum) return executed;
                if (claimAndRun(List.of(type))) {
                    executed++;
                    progressed = true;
                }
            }
        } while (progressed);
        return executed;
    }

    private boolean claimAndRun(java.util.Collection<String> types) {
        Instant now = Instant.now(clock);
        return repository.claimNext(types, owner, now, now.plus(properties.leaseDuration()))
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
        java.util.Map<String, String> previous = org.slf4j.MDC.getCopyOfContextMap();
        org.slf4j.MDC.put("jobId", run.id().toString());
        org.slf4j.MDC.put("jobType", run.jobType());
        try { executeBatch(run); }
        finally {
            if (previous == null) org.slf4j.MDC.clear();
            else org.slf4j.MDC.setContextMap(previous);
        }
    }

    private void executeBatch(JobRun run) {
        JobDefinition definition = registry.require(run.jobType());
        try {
            enforceScope(definition, run.tenantId());
            JobBatchResult result = inScopeTransaction(definition, run, () -> definition.executeBatch(context(run)));
            boolean cancelled = definition.cancellable() && repository.isCancellationRequested(run.id(), owner);
            Instant now = Instant.now(clock);
            if (!cancelled) {
                try {
                    if (result.completed()) repository.complete(run.id(), owner, result.processedCount(), now);
                    else repository.releaseForMore(run.id(), owner, result.processedCount(), now);
                } catch (JobLeaseLostException stateChanged) {
                    if (definition.cancellable() && repository.isCancellationRequested(run.id(), owner)) cancelled = true;
                    else throw stateChanged;
                }
            }
            if (cancelled) finishCancellation(definition, run, result.processedCount());
            meters.counter("my_bill.jobs.executed", "job_type", run.jobType(), "outcome",
                    cancelled ? "cancelled" : result.completed() ? "succeeded" : "continued").increment();
        } catch (JobLeaseLostException leaseLost) {
            recordLeaseLost(run);
        } catch (Exception failure) {
            if (definition.cancellable() && repository.isCancellationRequested(run.id(), owner)) {
                try {
                    finishCancellation(definition, run, 0);
                    meters.counter("my_bill.jobs.executed", "job_type", run.jobType(), "outcome", "cancelled").increment();
                } catch (JobLeaseLostException leaseLost) {
                    recordLeaseLost(run);
                }
                return;
            }
            boolean retry = definition.retryable() && run.attemptCount() < run.maxAttempts();
            LOG.warn("后台任务执行失败 jobType={} runId={} error={}",
                    run.jobType(), run.id(), safeError(failure));
            try {
                repository.failOrRetry(run.id(), owner, retry, safeError(failure), Instant.now(clock));
            } catch (JobLeaseLostException leaseLost) {
                if (definition.cancellable() && repository.isCancellationRequested(run.id(), owner)) {
                    try {
                        finishCancellation(definition, run, 0);
                        meters.counter("my_bill.jobs.executed", "job_type", run.jobType(), "outcome", "cancelled").increment();
                    } catch (JobLeaseLostException cancellationLost) {
                        recordLeaseLost(run);
                    }
                } else {
                    recordLeaseLost(run);
                }
                return;
            }
            meters.counter("my_bill.jobs.executed", "job_type", run.jobType(),
                    "outcome", retry ? "retry" : "failed").increment();
        }
    }

    private void finishCancellation(JobDefinition definition, JobRun run, long processedCount) {
        inScopeTransaction(definition, run, () -> {
            definition.onCancellationWon(context(run));
            repository.cancel(run.id(), owner, processedCount, Instant.now(clock));
            return null;
        });
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
