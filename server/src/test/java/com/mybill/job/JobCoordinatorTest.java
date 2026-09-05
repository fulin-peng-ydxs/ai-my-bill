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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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

        assertThat(coordinator(repository, definition).recoverExpired()).isEqualTo(1);
        verify(repository).recoverExpired(run.id(), false, "LEASE_EXPIRED", NOW);
    }

    @Test
    void leaseHeartbeatCommitsOutsideTheBusinessBatchTransaction() throws Exception {
        Transactional annotation = JdbcJobRunRepository.class
                .getMethod("renew", UUID.class, String.class, Instant.class, Instant.class)
                .getAnnotation(Transactional.class);
        assertThat(annotation).isNotNull();
        assertThat(annotation.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @SuppressWarnings("unchecked")
    private static JobCoordinator coordinator(JobRunRepository repository, JobDefinition definition) {
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        when(transactions.execute(any())).thenAnswer(invocation -> {
            TransactionCallback<Object> callback = invocation.getArgument(0);
            return callback.doInTransaction(mock(TransactionStatus.class));
        });
        return new JobCoordinator(repository, new JobDefinitionRegistry(List.of(definition)),
                mock(TenantDatabaseExecutor.class), transactions, new SimpleMeterRegistry(),
                new JobRunnerProperties(Duration.ofSeconds(30)), Clock.fixed(NOW, ZoneOffset.UTC), "owner");
    }

    private static JobDefinition definition(boolean cancellable, boolean retryable, Work work) {
        return new JobDefinition() {
            public String jobType() { return "TEST_JOB"; }
            public JobScope scope() { return JobScope.GLOBAL; }
            public boolean cancellable() { return cancellable; }
            public boolean retryable() { return retryable; }
            public JobBatchResult executeBatch(JobExecutionContext context) throws Exception { return work.run(context); }
        };
    }

    @FunctionalInterface private interface Work { JobBatchResult run(JobExecutionContext context) throws Exception; }
}
