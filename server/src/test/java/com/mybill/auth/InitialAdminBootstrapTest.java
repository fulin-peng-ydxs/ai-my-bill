package com.mybill.auth;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class InitialAdminBootstrapTest {
    @TempDir Path directory;

    @Test
    void refusesExistingAccountsWithoutOverwritingCredentials() throws Exception {
        InitialAdminMapper mapper = mock(InitialAdminMapper.class);
        when(mapper.countAccounts()).thenReturn(1L);
        TransactionTemplate transaction = transaction();
        var bootstrap = bootstrap(mapper, transaction, "R7sT9aB2cD4eF6gH8jK3");
        assertThatThrownBy(() -> bootstrap.run(new DefaultApplicationArguments()))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("已有账号");
        verify(mapper).lockAccounts();
        verify(mapper, never()).insert(any(), any(), any(), any());
        verify(mapper, never()).audit(any(), any());
    }

    @Test
    void writesHashedTemporaryCredentialAndAuditInOneTransaction() throws Exception {
        InitialAdminMapper mapper = mock(InitialAdminMapper.class);
        when(mapper.insert(any(), eq("admin"), eq("encoded-digest"), any())).thenReturn(1);
        when(mapper.audit(any(), any())).thenReturn(1);
        var bootstrap = bootstrap(mapper, transaction(), "R7sT9aB2cD4eF6gH8jK3");
        bootstrap.run(new DefaultApplicationArguments());
        var order = inOrder(mapper);
        order.verify(mapper).lockAccounts();
        order.verify(mapper).countAccounts();
        order.verify(mapper).insert(any(), eq("admin"), eq("encoded-digest"), any());
        order.verify(mapper).audit(any(), any());
    }

    @Test
    void rejectsWeakPasswordBeforeDatabaseAccess() throws Exception {
        InitialAdminMapper mapper = mock(InitialAdminMapper.class);
        var bootstrap = bootstrap(mapper, transaction(), "short");
        assertThatThrownBy(() -> bootstrap.run(new DefaultApplicationArguments()))
                .isInstanceOf(com.mybill.shared.api.ApiException.class);
        verifyNoInteractions(mapper);
    }

    private InitialAdminBootstrap bootstrap(InitialAdminMapper mapper, TransactionTemplate tx,
                                             String password) throws Exception {
        Path file = directory.resolve("password");
        Files.writeString(file, password);
        var env = new MockEnvironment().withProperty("MY_BILL_BOOTSTRAP_USERNAME", "admin")
                .withProperty("MY_BILL_BOOTSTRAP_PASSWORD_FILE", file.toString());
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        when(encoder.encode(anyString())).thenReturn("encoded-digest");
        return new InitialAdminBootstrap(mapper, tx, encoder, new PasswordPolicy(), env, Clock.systemUTC());
    }

    private TransactionTemplate transaction() {
        TransactionTemplate tx = mock(TransactionTemplate.class);
        doAnswer(invocation -> {
            Consumer<org.springframework.transaction.TransactionStatus> action = invocation.getArgument(0);
            action.accept(mock(org.springframework.transaction.TransactionStatus.class));
            return null;
        }).when(tx).executeWithoutResult(any());
        return tx;
    }
}
