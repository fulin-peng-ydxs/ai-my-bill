package com.mybill.shared.persistence;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;
import java.util.function.Supplier;

/** 在一个数据库事务内设置只对当前事务生效的 PostgreSQL RLS 租户上下文。 */
@Component
public final class TenantDatabaseExecutor {
    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;

    public TenantDatabaseExecutor(JdbcClient jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public <T> T execute(UUID tenantId, Supplier<T> work) {
        if (tenantId == null) {
            throw new IllegalArgumentException("tenantId must not be null");
        }
        return transactions.execute(status -> {
            String appliedTenant = jdbc.sql("SELECT set_config('app.tenant_id', :tenantId, true)")
                    .param("tenantId", tenantId.toString()).query(String.class).single();
            if (!tenantId.toString().equals(appliedTenant)) {
                status.setRollbackOnly();
                throw new IllegalStateException("数据库拒绝设置租户安全上下文");
            }
            return work.get();
        });
    }
}
