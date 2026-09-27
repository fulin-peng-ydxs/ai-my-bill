package com.mybill;

import com.mybill.admin.audit.AdminAuditRepository;
import com.mybill.account.AccountDeletionRepositoryMapper;
import com.mybill.account.AccountDeletionFileRecovery;
import com.mybill.auth.AuthRepository;
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
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest(properties = {
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "spring.flyway.enabled=false"
})
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
class MyBillApplicationTest {

    @MockitoBean
    private AuthRepository authRepository;

    @MockitoBean
    private TenantTransactionExecutor tenantTransactionExecutor;

    @MockitoBean private TenantDatabaseExecutor tenantDatabaseExecutor;
    @MockitoBean private AdminAuditRepository adminAuditRepository;
    @MockitoBean private JobRunRepository jobRunRepository;
    @MockitoBean private JobCoordinator jobCoordinator;
    @MockitoBean private AccountDeletionFileRecovery accountDeletionFileRecovery;

    @Test
    void contextLoads() {
    }
}
