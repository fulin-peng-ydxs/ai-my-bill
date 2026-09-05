package com.mybill;

import com.mybill.auth.AuthRepository;
import com.mybill.auth.TenantTransactionExecutor;
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

    @Test
    void contextLoads() {
    }
}
