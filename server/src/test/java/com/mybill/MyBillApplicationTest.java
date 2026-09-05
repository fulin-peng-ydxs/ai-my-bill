package com.mybill;

import com.mybill.admin.audit.AdminAuditRepository;
import com.mybill.auth.AuthRepository;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.job.JobCoordinator;
import com.mybill.job.JobRunRepository;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest(properties = {
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "spring.flyway.enabled=false"
})
class MyBillApplicationTest {

    @MockitoBean
    private AuthRepository authRepository;

    @MockitoBean
    private TenantTransactionExecutor tenantTransactionExecutor;

    @MockitoBean private TenantDatabaseExecutor tenantDatabaseExecutor;
    @MockitoBean private AdminAuditRepository adminAuditRepository;
    @MockitoBean private JobRunRepository jobRunRepository;
    @MockitoBean private JobCoordinator jobCoordinator;

    @Test
    void contextLoads() {
    }
}
