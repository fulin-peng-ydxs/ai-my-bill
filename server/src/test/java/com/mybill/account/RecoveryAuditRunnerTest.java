package com.mybill.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.mock.env.MockEnvironment;
import java.nio.file.Path;
import java.nio.file.Files;
import java.time.Clock;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RecoveryAuditRunnerTest {
    @TempDir Path directory;
    @Test void refusesLiveDatabaseAndMismatchedFingerprintBeforeAnyWrite() {
        RecoveryAuditMapper mapper = mock(RecoveryAuditMapper.class);
        var deletion = mock(AccountDeletionService.class);
        when(mapper.databaseName()).thenReturn("my_bill");
        var env = new MockEnvironment().withProperty("MY_BILL_RECOVERY_ACTION", "replay")
                .withProperty("MY_BILL_RECOVERY_AUDIT_FILE", directory.resolve("audit").toString())
                .withProperty("MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT", "expected");
        var runner = new RecoveryAuditRunner(mapper, deletion, mock(AccountDeletionFileRecovery.class), new ObjectMapper(), env, Clock.systemUTC());
        assertThrows(IllegalStateException.class, () -> runner.run(new DefaultApplicationArguments()));
        when(mapper.databaseName()).thenReturn("my_bill_restore_drill");
        when(mapper.fingerprint()).thenReturn("different");
        assertThrows(IllegalStateException.class, () -> runner.run(new DefaultApplicationArguments()));
        verify(mapper, never()).importAudit(anyString()); verifyNoInteractions(deletion);
    }
    @Test void rejectsTruncationBeforeApplyingAnyRecord() throws Exception {
        Path file = directory.resolve("audit");
        Files.writeString(file, "{\"format\":\"my-bill-deletion-audit-v1\"}\n");
        var mapper = mock(RecoveryAuditMapper.class);
        when(mapper.databaseName()).thenReturn("my_bill_restore_drill");
        when(mapper.fingerprint()).thenReturn("expected");
        var env = new MockEnvironment().withProperty("MY_BILL_RECOVERY_ACTION", "replay")
                .withProperty("MY_BILL_RECOVERY_AUDIT_FILE", file.toString())
                .withProperty("MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT", "expected");
        var runner = new RecoveryAuditRunner(mapper, mock(AccountDeletionService.class), mock(AccountDeletionFileRecovery.class), new ObjectMapper(), env, Clock.systemUTC());
        assertThrows(IllegalArgumentException.class, () -> runner.run(new DefaultApplicationArguments()));
        verify(mapper, never()).importAudit(anyString());
    }
    @Test void retriesFileCompensationEvenWhenNoRestoredAccountRemains() throws Exception {
        Path file = directory.resolve("complete-audit");
        Files.writeString(file, "{\"format\":\"my-bill-deletion-audit-v1\"}\n{\"complete\":0}\n");
        var mapper = mock(RecoveryAuditMapper.class);
        var files = mock(AccountDeletionFileRecovery.class);
        when(mapper.databaseName()).thenReturn("my_bill_restore_drill");
        when(mapper.fingerprint()).thenReturn("expected");
        var env = new MockEnvironment().withProperty("MY_BILL_RECOVERY_ACTION", "replay")
                .withProperty("MY_BILL_RECOVERY_AUDIT_FILE", file.toString())
                .withProperty("MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT", "expected");
        var runner = new RecoveryAuditRunner(mapper, mock(AccountDeletionService.class), files,
                new ObjectMapper(), env, Clock.systemUTC());
        runner.run(new DefaultApplicationArguments());
        verify(files).recover();
        verify(mapper, never()).importAudit(anyString());
    }

}
