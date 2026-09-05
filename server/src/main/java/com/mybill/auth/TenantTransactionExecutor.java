package com.mybill.auth;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;
import java.util.function.Supplier;

/**
 * 在同一数据库事务中设置 PostgreSQL RLS 租户上下文；事务结束或回滚后由数据库自动清理。
 */
@Component
public final class TenantTransactionExecutor {

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;

    public TenantTransactionExecutor(JdbcClient jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public <T> T execute(CurrentPrincipal principal, Supplier<T> work) {
        UUID tenantId = principal.requireTenantId();
        return transactions.execute(status -> {
            String appliedTenant = jdbc.sql("SELECT set_config('app.tenant_id', :tenantId, true)")
                    .param("tenantId", tenantId.toString())
                    .query(String.class)
                    .single();
            if (!tenantId.toString().equals(appliedTenant)) {
                status.setRollbackOnly();
                throw new IllegalStateException("数据库拒绝设置租户安全上下文");
            }
            return work.get();
        });
    }
}
