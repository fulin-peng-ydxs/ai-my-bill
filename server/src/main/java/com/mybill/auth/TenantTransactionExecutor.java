package com.mybill.auth;

import com.mybill.shared.persistence.TenantDatabaseExecutor;
import org.springframework.stereotype.Component;
import java.util.function.Supplier;

/**
 * 在同一数据库事务中设置 PostgreSQL RLS 租户上下文；事务结束或回滚后由数据库自动清理。
 */
@Component
public final class TenantTransactionExecutor {

    private final TenantDatabaseExecutor delegate;

    public TenantTransactionExecutor(TenantDatabaseExecutor delegate) {
        this.delegate = delegate;
    }

    public <T> T execute(CurrentPrincipal principal, Supplier<T> work) {
        return delegate.execute(principal.requireTenantId(), work);
    }
}
