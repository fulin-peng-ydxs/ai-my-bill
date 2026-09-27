package com.mybill.shared.api;

import com.mybill.admin.audit.AdminAuditRepository;
import com.mybill.account.AccountDeletionRepositoryMapper;
import com.mybill.auth.AuthRepository;
import com.mybill.auth.AuthenticationService;
import com.mybill.auth.TenantTransactionExecutor;
import com.mybill.job.JobCoordinator;
import com.mybill.job.JobRunRepository;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import com.mybill.admin.dictionary.DefaultDictionaryRepositoryMapper;
import com.mybill.admin.user.AdminUserRepositoryMapper;
import com.mybill.dictionary.*;
import com.mybill.ledger.*;
import com.mybill.preference.PreferenceRepositoryMapper;
import com.mybill.report.ReportRepositoryMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.dao.DataAccessResourceFailureException;

import jakarta.servlet.http.Cookie;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@SpringBootTest(properties = {
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "spring.flyway.enabled=false"
})
@AutoConfigureMockMvc
@MockitoBean(types = {
        DefaultDictionaryRepositoryMapper.class, AdminUserRepositoryMapper.class,
        ExpenseDictionaryServiceMapper.class, IncomeDictionaryServiceMapper.class,
        PersonalDictionaryRepositoryMapper.class, ProductMergeRepositoryMapper.class,
        DailyTemplateRepositoryMapper.class, ExpenseAdjustmentRepositoryMapper.class,
        ExpenseRepositoryMapper.class, ExpiredLedgerPurgeJobMapper.class, ExportCsvWriterMapper.class,
        ExportRepositoryMapper.class, IncomeRepositoryMapper.class, LedgerIdempotencyStoreMapper.class,
        LedgerLifecycleRepositoryMapper.class, LedgerQueryRepositoryMapper.class,
        PreferenceRepositoryMapper.class, ReportRepositoryMapper.class,
        AccountDeletionRepositoryMapper.class
})
class HttpContractTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AuthRepository authRepository;

    @MockitoBean
    private AuthenticationService authenticationService;

    @MockitoBean
    private TenantTransactionExecutor tenantTransactionExecutor;

    @MockitoBean private TenantDatabaseExecutor tenantDatabaseExecutor;
    @MockitoBean private AdminAuditRepository adminAuditRepository;
    @MockitoBean private JobRunRepository jobRunRepository;
    @MockitoBean private JobCoordinator jobCoordinator;

    @Test
    void exposesTheMinimalHealthEndpointWithATraceId() throws Exception {
        mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(header().exists(TraceIdFilter.TRACE_ID_HEADER))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("XSRF-TOKEN=")))
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void rejectsUnknownApiResourcesByDefaultWithTheStableErrorShape() throws Exception {
        mockMvc.perform(get("/api/v1/not-registered"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().exists(TraceIdFilter.TRACE_ID_HEADER))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.message").isNotEmpty())
                .andExpect(jsonPath("$.fieldErrors").isMap())
                .andExpect(jsonPath("$.traceId").isNotEmpty())
                .andExpect(jsonPath("$.retryable").value(false));
    }

    @Test
    void doesNotExposeActuatorEndpointsMissingFromTheOpenApiContract() throws Exception {
        mockMvc.perform(get("/api/v1/info"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void failsClosedWhenSessionStorageIsUnavailable() throws Exception {
        when(authenticationService.authenticate(anyString()))
                .thenThrow(new DataAccessResourceFailureException("test storage outage"));

        mockMvc.perform(get("/api/v1/auth/session")
                        .cookie(new Cookie("MY_BILL_SESSION", "synthetic-session-token")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("AUTH_STORAGE_UNAVAILABLE"))
                .andExpect(jsonPath("$.retryable").value(true));
    }
}
