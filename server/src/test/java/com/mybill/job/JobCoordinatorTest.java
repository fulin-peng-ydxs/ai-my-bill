package com.mybill.job;

import com.mybill.shared.persistence.TenantDatabaseExecutor;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.doAnswer;

class JobCoordinatorTest {
    private static final Instant NOW = Instant.parse("2026-09-05T12:00:00Z");

    @Test
    void retriesWithoutPersistingExceptionMessage() {
        JobRunRepository repository = mock(JobRunRepository.class);
        JobDefinition definition = definition(true, true, context -> { throw new Exception("token=must-not-leak"); });
        JobRun run = new JobRun(UUID.randomUUID(), null, "TEST_JOB", "batch-1", "RUNNING",
                0, 1, 3, "owner", NOW.plusSeconds(30), false);
        when(repository.findExpired(NOW)).thenReturn(List.of());
        when(repository.claimNext(any(), anyString(), any(), any())).thenReturn(Optional.of(run));

        coordinator(repository, definition).runNext();

        ArgumentCaptor<String> error = ArgumentCaptor.forClass(String.class);
        verify(repository).failOrRetry(eq(run.id()), eq("owner"), eq(true), error.capture(), any());
        assertThat(error.getValue()).isEqualTo("Exception").doesNotContain("token");
    }

    @Test
    void expiredLeaseConvergesToFailureWhenRetryBudgetIsExhausted() {
        JobRunRepository repository = mock(JobRunRepository.class);
        JobDefinition definition = definition(true, true, context -> JobBatchResult.completed(0));
        JobRun run = new JobRun(UUID.randomUUID(), null, "TEST_JOB", "batch-1", "RUNNING",
                0, 3, 3, "dead-owner", NOW.minusSeconds(1), false);
        when(repository.findExpired(NOW)).thenReturn(List.of(run));
        when(repository.recoverExpired(run.id(), false, "LEASE_EXPIRED", NOW)).thenReturn(true);

        assertThat(coordinator(repository, definition).recoverExpired()).isEqualTo(1);
        verify(repository).recoverExpired(run.id(), false, "LEASE_EXPIRED", NOW);
    }

    @Test
    void expiredLeaseIsCountedOnlyByTheInstanceThatChangesItsState() {
        JobRunRepository repository = mock(JobRunRepository.class);
        JobDefinition definition = definition(true, true, context -> JobBatchResult.completed(0));
        JobRun run = new JobRun(UUID.randomUUID(), null, "TEST_JOB", "batch-1", "RUNNING",
                0, 1, 3, "dead-owner", NOW.minusSeconds(1), false);
        when(repository.findExpired(NOW)).thenReturn(List.of(run));
        when(repository.recoverExpired(run.id(), true, "LEASE_EXPIRED", NOW)).thenReturn(true, false);
        SimpleMeterRegistry meters = new SimpleMeterRegistry();
        JobCoordinator coordinator = coordinator(repository, definition, meters);

        assertThat(coordinator.recoverExpired()).isEqualTo(1);
        assertThat(coordinator.recoverExpired()).isZero();
        assertThat(meters.counter("my_bill.jobs.recovered", "job_type", "TEST_JOB", "outcome", "retry").count())
                .isEqualTo(1);
    }

    @Test
    void leaseLossDuringCompletionDoesNotRetryOrEscapeTheRunner() {
        JobRunRepository repository = mock(JobRunRepository.class);
        JobDefinition definition = definition(true, true, context -> JobBatchResult.completed(1));
        JobRun run = new JobRun(UUID.randomUUID(), null, "TEST_JOB", "batch-1", "RUNNING",
                0, 1, 3, "owner", NOW.plusSeconds(30), false);
        when(repository.findExpired(NOW)).thenReturn(List.of());
        when(repository.claimNext(any(), anyString(), any(), any())).thenReturn(Optional.of(run));
        doThrow(new JobLeaseLostException()).when(repository).complete(run.id(), "owner", 1, NOW);
        SimpleMeterRegistry meters = new SimpleMeterRegistry();

        assertThat(coordinator(repository, definition, meters).runNext()).isTrue();
        verify(repository, never()).failOrRetry(any(), anyString(), eq(true), anyString(), any());
        assertThat(meters.counter("my_bill.jobs.executed", "job_type", "TEST_JOB", "outcome", "lease_lost").count())
                .isEqualTo(1);
    }

    @Test
    void leaseHeartbeatCommitsOutsideTheBusinessBatchTransaction() throws Exception {
        Transactional annotation = MybatisJobRunRepository.class
                .getMethod("renew", UUID.class, String.class, Instant.class, Instant.class)
                .getAnnotation(Transactional.class);
        assertThat(annotation).isNotNull();
        assertThat(annotation.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    void boundedDrainGivesEachAvailableJobTypeAChancePerRound() {
        JobRunRepository repository = mock(JobRunRepository.class);
        JobDefinition first = definition("A_JOB", false, false, context -> JobBatchResult.completed(1));
        JobDefinition second = definition("B_JOB", false, false, context -> JobBatchResult.completed(1));
        JobRun a = new JobRun(UUID.randomUUID(), null, "A_JOB", "a", "RUNNING",
                0, 1, 3, "owner", NOW.plusSeconds(30), false);
        JobRun b = new JobRun(UUID.randomUUID(), null, "B_JOB", "b", "RUNNING",
                0, 1, 3, "owner", NOW.plusSeconds(30), false);
        when(repository.findExpired(NOW)).thenReturn(List.of());
        when(repository.claimNext(eq(List.of("A_JOB")), anyString(), any(), any()))
                .thenReturn(Optional.of(a), Optional.empty());
        when(repository.claimNext(eq(List.of("B_JOB")), anyString(), any(), any()))
                .thenReturn(Optional.of(b), Optional.empty());
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        when(transactions.execute(any())).thenAnswer(invocation -> {
            TransactionCallback<Object> callback = invocation.getArgument(0);
            return callback.doInTransaction(mock(TransactionStatus.class));
        });
        JobCoordinator coordinator = new JobCoordinator(repository, new JobDefinitionRegistry(List.of(first, second)),
                mock(TenantDatabaseExecutor.class), transactions, new SimpleMeterRegistry(),
                new JobRunnerProperties(Duration.ofSeconds(30), 10), Clock.fixed(NOW, ZoneOffset.UTC), "owner");

        assertThat(coordinator.runAvailable(10)).isEqualTo(2);
        verify(repository).complete(a.id(), "owner", 1, NOW);
        verify(repository).complete(b.id(), "owner", 1, NOW);
    }

    @Test
    void cancellationThatWinsWhileCompletionIsInFlightRunsCompensationAndCancelsTheJob() throws Exception {
        JobRunRepository repository = mock(JobRunRepository.class);
        AtomicBoolean compensated = new AtomicBoolean();
        AtomicBoolean cancellationRequested = new AtomicBoolean();
        CountDownLatch completionStarted = new CountDownLatch(1);
        CountDownLatch finishCompletion = new CountDownLatch(1);
        JobDefinition definition = new JobDefinition() {
            public String jobType() { return "TEST_JOB"; }
            public JobScope scope() { return JobScope.GLOBAL; }
            public boolean cancellable() { return true; }
            public boolean retryable() { return false; }
            public JobBatchResult executeBatch(JobExecutionContext context) { return JobBatchResult.completed(7); }
            public void onCancellationWon(JobExecutionContext context) { compensated.set(true); }
        };
        JobRun run = new JobRun(UUID.randomUUID(), null, "TEST_JOB", "batch-1", "RUNNING",
                0, 1, 3, "owner", NOW.plusSeconds(30), false);
        when(repository.findExpired(NOW)).thenReturn(List.of());
        when(repository.claimNext(any(), anyString(), any(), any())).thenReturn(Optional.of(run));
        when(repository.isCancellationRequested(run.id(), "owner"))
                .thenAnswer(invocation -> cancellationRequested.get());
        doAnswer(invocation -> {
            completionStarted.countDown();
            assertThat(finishCompletion.await(5, TimeUnit.SECONDS)).isTrue();
            if (cancellationRequested.get()) throw new JobLeaseLostException();
            return null;
        }).when(repository).complete(run.id(), "owner", 7, NOW);

        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<Boolean> result = executor.submit(() -> coordinator(repository, definition).runNext());
            assertThat(completionStarted.await(5, TimeUnit.SECONDS)).isTrue();
            cancellationRequested.set(true);
            finishCompletion.countDown();
            assertThat(result.get(5, TimeUnit.SECONDS)).isTrue();
        } finally {
            executor.shutdownNow();
        }

        assertThat(compensated).isTrue();
        verify(repository).cancel(run.id(), "owner", 7, NOW);
        verify(repository, never()).failOrRetry(any(), anyString(), eq(false), anyString(), any());
    }

    @SuppressWarnings("unchecked")
    private static JobCoordinator coordinator(JobRunRepository repository, JobDefinition definition) {
        return coordinator(repository, definition, new SimpleMeterRegistry());
    }

    @SuppressWarnings("unchecked")
    private static JobCoordinator coordinator(JobRunRepository repository, JobDefinition definition,
                                               SimpleMeterRegistry meters) {
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        when(transactions.execute(any())).thenAnswer(invocation -> {
            TransactionCallback<Object> callback = invocation.getArgument(0);
            return callback.doInTransaction(mock(TransactionStatus.class));
        });
        return new JobCoordinator(repository, new JobDefinitionRegistry(List.of(definition)),
                mock(TenantDatabaseExecutor.class), transactions, meters,
                new JobRunnerProperties(Duration.ofSeconds(30), 20), Clock.fixed(NOW, ZoneOffset.UTC), "owner");
    }

    private static JobDefinition definition(boolean cancellable, boolean retryable, Work work) {
        return definition("TEST_JOB", cancellable, retryable, work);
    }

    private static JobDefinition definition(String type, boolean cancellable, boolean retryable, Work work) {
        return new JobDefinition() {
            public String jobType() { return type; }
            public JobScope scope() { return JobScope.GLOBAL; }
            public boolean cancellable() { return cancellable; }
            public boolean retryable() { return retryable; }
            public JobBatchResult executeBatch(JobExecutionContext context) throws Exception { return work.run(context); }
        };
    }

    @FunctionalInterface private interface Work { JobBatchResult run(JobExecutionContext context) throws Exception; }
}
