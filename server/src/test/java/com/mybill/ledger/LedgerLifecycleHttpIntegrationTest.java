package com.mybill.ledger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.job.JobCoordinator;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t17-lifecycle-pepper",
        "my-bill.schema.validation-enabled=false", "my-bill.jobs.poll-delay-ms=600000"})
@AutoConfigureMockMvc
@Import(LedgerLifecycleHttpIntegrationTest.FixedClockConfiguration.class)
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class LedgerLifecycleHttpIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-09-07T07:00:00Z");
    private static final UUID TENANT = uuid("17100000-0000-4000-8000-000000000001");
    private static final UUID OTHER = uuid("17100000-0000-4000-8000-000000000002");
    private static final UUID USER = uuid("17200000-0000-4000-8000-000000000001");
    private static final UUID ADMIN = uuid("17200000-0000-4000-8000-000000000002");
    private static final UUID EXPENSE = uuid("17300000-0000-4000-8000-000000000001");
    private static final UUID EXPIRED = uuid("17300000-0000-4000-8000-000000000002");
    private static final UUID INCOME = uuid("17300000-0000-4000-8000-000000000003");
    private static final UUID PURGE_EXPENSE = uuid("17300000-0000-4000-8000-000000000004");
    private static final UUID FOREIGN = uuid("17300000-0000-4000-8000-000000000099");
    private static final UUID ADJUSTMENT = uuid("17400000-0000-4000-8000-000000000001");
    private static final UUID SECOND_ADJUSTMENT = uuid("17400000-0000-4000-8000-000000000002");
    private static final UUID PURGE_ADJUSTMENT = uuid("17400000-0000-4000-8000-000000000003");
    private static final String PASSWORD = "T17-Formal-Password-2026";

    @Autowired MockMvc mockMvc; @Autowired ObjectMapper mapper; @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder; @Autowired TenantDatabaseExecutor tenantDatabase;
    @Autowired JobCoordinator jobs;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url); registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test"); registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration"); registry.add("spring.flyway.password", () -> "migration_test");
    }

    @Test @Order(1) void prepare() {
        jdbc.sql("INSERT INTO tenant(id) VALUES(:tenant),(:other)").param("tenant", TENANT).param("other", OTHER).update();
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,'t17-user',:password,'USER',:tenant)")
                .param("id", USER).param("password", passwordEncoder.encode(PASSWORD)).param("tenant", TENANT).update();
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role) VALUES(:id,'t17-admin',:password,'ADMIN')")
                .param("id", ADMIN).param("password", passwordEncoder.encode(PASSWORD)).update();
        tenantDatabase.execute(TENANT, () -> {
            insertExpense(EXPENSE, "联动支出", "100.00"); insertExpense(EXPIRED, "到期支出", "20.00");
            insertIncome(INCOME); insertAdjustment(ADJUSTMENT, EXPENSE, "30.00");
            insertExpense(PURGE_EXPENSE, "单独清理支出", "50.00");
            insertAdjustment(PURGE_ADJUSTMENT, PURGE_EXPENSE, "5.00"); return null;
        });
        tenantDatabase.execute(OTHER, () -> { insertExpense(FOREIGN, "其他租户支出", "10.00"); return null; });
    }

    @Test @Order(2) void sourceTrashFreezesAndRestoreReactivatesAdjustments() throws Exception {
        Cookie user = login("t17-user");
        JsonNode trashed = lifecycle(user, "/api/v1/ledger-entries/{id}/trash", EXPENSE, 0, "trash-source", 200);
        assertThat(trashed.path("linkedAdjustmentCount").asInt()).isEqualTo(1);
        assertThat(trashed.path("lifecycleStatus").asText()).isEqualTo("TRASHED");
        assertThat(adjustmentStatus(ADJUSTMENT)).isEqualTo("SOURCE_FROZEN");
        JsonNode replay = lifecycle(user, "/api/v1/ledger-entries/{id}/trash", EXPENSE, 0, "trash-source", 200);
        assertThat(replay.path("version").asLong()).isEqualTo(1);

        JsonNode active = page(user, "ACTIVE", "联动支出");
        assertThat(active.path("items")).isEmpty();
        JsonNode trash = page(user, "TRASHED", "联动支出");
        assertThat(trash.path("items")).hasSize(1);
        assertThat(trash.path("items").get(0).path("remainingDays").asInt()).isEqualTo(30);

        lifecycle(user, "/api/v1/ledger-entries/{id}/restore", EXPENSE, 1, "restore-source", 200);
        assertThat(adjustmentStatus(ADJUSTMENT)).isEqualTo("EFFECTIVE");
        assertThat(page(user, "ACTIVE", "联动支出").path("items")).hasSize(2);
    }

    @Test @Order(3) void incomeAndAdjustmentUseTheSameRecycleBinWithoutMixingActions() throws Exception {
        Cookie user = login("t17-user");
        lifecycle(user, "/api/v1/ledger-entries/{id}/trash", INCOME, 0, "trash-income", 200);
        assertThat(page(user, "TRASHED", "工资").path("items")).hasSize(1);
        lifecycle(user, "/api/v1/ledger-entries/{id}/restore", INCOME, 1, "restore-income", 200);

        JsonNode trashedAdjustment = lifecycle(user, "/api/v1/adjustments/{id}/trash", ADJUSTMENT,
                adjustmentVersion(ADJUSTMENT), "trash-adjustment", 200);
        JsonNode source = page(user, "ACTIVE", "联动支出");
        assertThat(source.path("items")).hasSize(1);
        assertThat(source.path("items").get(0).path("netExpenseAmount").asText()).isEqualTo("100.00");
        JsonNode trash = page(user, "TRASHED", "联动支出");
        assertThat(trash.path("items").get(0).path("entryType").asText()).isEqualTo("ADJUSTMENT");
        lifecycle(user, "/api/v1/adjustments/{id}/restore", ADJUSTMENT,
                trashedAdjustment.path("version").asLong(), "restore-adjustment", 200);
        assertThat(adjustmentStatus(ADJUSTMENT)).isEqualTo("EFFECTIVE");

        JsonNode individuallyTrashed = lifecycle(user, "/api/v1/adjustments/{id}/trash", PURGE_ADJUSTMENT,
                adjustmentVersion(PURGE_ADJUSTMENT), "trash-individual-adjustment", 200);
        lifecycle(user, "/api/v1/adjustments/{id}/purge", PURGE_ADJUSTMENT,
                individuallyTrashed.path("version").asLong(), "purge-individual-adjustment", 204);
        assertThat(adjustmentCount(PURGE_ADJUSTMENT)).isZero();
        assertThat(ledgerCount(PURGE_EXPENSE)).isOne();
        assertThat(jdbc.sql("SELECT count(*) FROM job_run WHERE tenant_id=:tenant AND job_type=:type AND batch_key LIKE 'purge-minute:%'")
                .param("tenant", TENANT).param("type", ExpiredLedgerPurgeJob.TYPE).query(Long.class).single()).isOne();
    }

    @Test @Order(4) void adjustmentRestoreRechecksCumulativeCapAndSourcePurgeIsAtomic() throws Exception {
        Cookie user = login("t17-user");
        JsonNode trashedAdjustment = lifecycle(user, "/api/v1/adjustments/{id}/trash", ADJUSTMENT,
                adjustmentVersion(ADJUSTMENT), "trash-for-cap", 200);
        tenantDatabase.execute(TENANT, () -> { insertAdjustment(SECOND_ADJUSTMENT, EXPENSE, "80.00"); return null; });
        lifecycle(user, "/api/v1/adjustments/{id}/restore", ADJUSTMENT,
                trashedAdjustment.path("version").asLong(), "restore-over-cap", 409);
        assertThat(adjustmentStatus(ADJUSTMENT)).isEqualTo("TRASHED");

        JsonNode trashedSource = lifecycle(user, "/api/v1/ledger-entries/{id}/trash", EXPENSE,
                ledgerVersion(EXPENSE), "trash-for-purge", 200);
        lifecycle(user, "/api/v1/ledger-entries/{id}/purge", EXPENSE,
                trashedSource.path("version").asLong(), "purge-source", 204);
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM ledger_entry WHERE id=:id")
                .param("id", EXPENSE).query(Long.class).single())).isZero();
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM expense_adjustment WHERE original_expense_id=:id")
                .param("id", EXPENSE).query(Long.class).single())).isZero();
    }

    @Test @Order(5) void permissionsTenantIsolationAndExpiredRestoreFailClosed() throws Exception {
        Cookie user = login("t17-user");
        lifecycle(user, "/api/v1/ledger-entries/{id}/trash", FOREIGN, 0, "foreign", 404);
        mockMvc.perform(post("/api/v1/ledger-entries/{id}/trash", EXPIRED).with(csrf())
                .header("Idempotency-Key", "anonymous").contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/ledger-entries/{id}/trash", EXPIRED).with(csrf()).cookie(login("t17-admin"))
                .header("Idempotency-Key", "admin").contentType(MediaType.APPLICATION_JSON).content("{\"version\":0}"))
                .andExpect(status().isForbidden());

        lifecycle(user, "/api/v1/ledger-entries/{id}/trash", EXPIRED, 0, "trash-expired", 200);
        tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("UPDATE ledger_entry SET deleted_at=:deleted,purge_after=:purge WHERE id=:id")
                    .param("deleted", Timestamp.from(NOW.minusSeconds(31L * 86400)))
                    .param("purge", Timestamp.from(NOW.minusSeconds(86400)))
                    .param("id", EXPIRED).update(); return null;
        });
        lifecycle(user, "/api/v1/ledger-entries/{id}/restore", EXPIRED, 1, "restore-expired", 409);
    }

    @Test @Order(6) void dueCleanupRunsAsAnAuditedIdempotentTenantBatch() {
        UUID run = jobs.schedule(ExpiredLedgerPurgeJob.TYPE, TENANT, "t17-expired-batch");
        runUntilFinished(run);
        assertThat(ledgerCount(EXPIRED)).isZero();
        assertThat(jdbc.sql("SELECT status || ':' || processed_count FROM job_run WHERE id=:id")
                .param("id", run).query(String.class).single()).isEqualTo("SUCCEEDED:1");
        UUID replay = jobs.schedule(ExpiredLedgerPurgeJob.TYPE, TENANT, "t17-expired-rerun");
        runUntilFinished(replay);
        assertThat(jdbc.sql("SELECT status || ':' || processed_count FROM job_run WHERE id=:id")
                .param("id", replay).query(String.class).single()).isEqualTo("SUCCEEDED:0");
    }

    private JsonNode lifecycle(Cookie user, String path, UUID id, long version, String key, int expected) throws Exception {
        MvcResult result = mockMvc.perform(post(path, id).with(csrf()).cookie(user).header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("version", version))))
                .andExpect(status().is(expected)).andReturn();
        return result.getResponse().getContentAsByteArray().length == 0 ? mapper.createObjectNode()
                : mapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private JsonNode page(Cookie user, String lifecycle, String query) throws Exception {
        return mapper.readTree(mockMvc.perform(get("/api/v1/ledger-entries").cookie(user)
                .queryParam("lifecycle", lifecycle).queryParam("query", query))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    }

    private Cookie login(String username) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("username", username, "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn();
        return result.getResponse().getCookie("MY_BILL_SESSION");
    }

    private String adjustmentStatus(UUID id) {
        return tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT status FROM expense_adjustment WHERE id=:id")
                .param("id", id).query(String.class).single());
    }

    private long adjustmentVersion(UUID id) {
        return tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT version FROM expense_adjustment WHERE id=:id")
                .param("id", id).query(Long.class).single());
    }

    private long ledgerVersion(UUID id) {
        return tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT version FROM ledger_entry WHERE id=:id")
                .param("id", id).query(Long.class).single());
    }

    private long adjustmentCount(UUID id) {
        return tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM expense_adjustment WHERE id=:id")
                .param("id", id).query(Long.class).single());
    }

    private long ledgerCount(UUID id) {
        return tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM ledger_entry WHERE id=:id")
                .param("id", id).query(Long.class).single());
    }

    private void runUntilFinished(UUID runId) {
        for (int attempt = 0; attempt < 10; attempt++) {
            String status = jdbc.sql("SELECT status FROM job_run WHERE id=:id")
                    .param("id", runId).query(String.class).single();
            if ("SUCCEEDED".equals(status)) return;
            assertThat(status).isIn("PENDING", "RUNNING");
            assertThat(jobs.runNext()).isTrue();
        }
        Assertions.fail("cleanup job did not finish within bounded polling");
    }

    private void insertExpense(UUID id, String title, String paid) {
        UUID product = UUID.randomUUID(), category = UUID.randomUUID(), unit = UUID.randomUUID(), funding = UUID.randomUUID();
        dictionary("expense_category", category, title + "分类"); dictionary("unit", unit, title + "单位");
        dictionary("funding_channel", funding, title + "渠道");
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", product).param("name", title).update();
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE','2026-09-07T14:00:00+08:00','2026-09-07',
                  :product,:title,:category,:categoryName,:unit,:unitName,:paid,1,:paid,:paid,:funding,:fundingName)
                """).param("id", id).param("product", product).param("title", title).param("category", category)
                .param("categoryName", title + "分类").param("unit", unit).param("unitName", title + "单位")
                .param("paid", new BigDecimal(paid)).param("funding", funding).param("fundingName", title + "渠道").update();
    }

    private void insertIncome(UUID id) {
        UUID payer = UUID.randomUUID(), category = UUID.randomUUID(), funding = UUID.randomUUID();
        dictionary("payer", payer, "T17公司"); dictionary("income_category", category, "T17工资");
        dictionary("funding_channel", funding, "T17银行卡");
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-07T14:00:00+08:00','2026-09-07',
                  '工资',:payer,'T17公司',:category,'T17工资',100,:funding,'T17银行卡')
                """).param("id", id).param("payer", payer).param("category", category).param("funding", funding).update();
    }

    private void insertAdjustment(UUID id, UUID expense, String amount) {
        jdbc.sql("""
                INSERT INTO expense_adjustment(tenant_id,id,original_expense_id,adjustment_type,amount,business_time,business_date)
                VALUES(current_setting('app.tenant_id')::uuid,:id,:expense,'REFUND',:amount,
                  '2026-09-07T14:30:00+08:00','2026-09-07')
                """).param("id", id).param("expense", expense).param("amount", new BigDecimal(amount)).update();
    }

    private void dictionary(String table, UUID id, String name) {
        jdbc.sql("INSERT INTO " + table + "(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", id).param("name", name).update();
    }

    private static UUID uuid(String value) { return UUID.fromString(value); }

    @TestConfiguration static class FixedClockConfiguration {
        @Bean @Primary Clock fixedLifecycleClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
    }
}
