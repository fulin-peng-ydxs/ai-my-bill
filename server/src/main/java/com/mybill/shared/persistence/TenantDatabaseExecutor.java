package com.mybill.shared.persistence;

import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;
import java.util.function.Supplier;

/** 在一个数据库事务内设置只对当前事务生效的 PostgreSQL RLS 租户上下文。 */
@Component
public final class TenantDatabaseExecutor {
    private final MybatisOperations operations;
    private final TenantDatabaseExecutorMapper mapper;
    private final TransactionTemplate transactions;

    public TenantDatabaseExecutor(MybatisOperations operations, TenantDatabaseExecutorMapper mapper, PlatformTransactionManager transactionManager) {
        this.operations = operations; this.mapper = mapper;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public <T> T execute(UUID tenantId, Supplier<T> work) {
        if (tenantId == null) {
            throw new IllegalArgumentException("tenantId must not be null");
        }
        return transactions.execute(status -> {
            String appliedTenant = operations.select(mapper::setTenantContext)
                    .param("tenantId", tenantId.toString()).map(String.class).single();
            if (!tenantId.toString().equals(appliedTenant)) {
                status.setRollbackOnly();
                throw new IllegalStateException("数据库拒绝设置租户安全上下文");
            }
            return work.get();
        });
    }
}
