package com.mybill.ledger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.job.JobCoordinator;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
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

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t18-export-pepper",
        "my-bill.schema.validation-enabled=false", "my-bill.jobs.poll-delay-ms=600000", "my-bill.export.retention=PT5M"})
@AutoConfigureMockMvc
@Import(ExportHttpIntegrationTest.ClockConfiguration.class)
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ExportHttpIntegrationTest {
    private static final Path EXPORT_DIRECTORY = Path.of("target", "t18-export-test").toAbsolutePath();
    private static final UUID TENANT = uuid("18100000-0000-4000-8000-000000000001");
    private static final UUID OTHER_TENANT = uuid("18100000-0000-4000-8000-000000000002");
    private static final UUID USER = uuid("18200000-0000-4000-8000-000000000001");
    private static final UUID OTHER_USER = uuid("18200000-0000-4000-8000-000000000002");
    private static final UUID ADMIN = uuid("18200000-0000-4000-8000-000000000003");
    private static final UUID EXPENSE = uuid("18300000-0000-4000-8000-000000000001");
    private static final UUID INCOME = uuid("18300000-0000-4000-8000-000000000002");
    private static final UUID ADJUSTMENT = uuid("18400000-0000-4000-8000-000000000001");
    private static final UUID FOREIGN = uuid("18300000-0000-4000-8000-000000000099");
    private static final String PASSWORD = "T18-Formal-Password-2026";

    @Autowired MockMvc mockMvc; @Autowired ObjectMapper mapper; @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder; @Autowired TenantDatabaseExecutor tenantDatabase;
    @Autowired JobCoordinator jobs; @Autowired MutableClock clock;
    private Cookie user; private Cookie other; private Cookie admin;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url); registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test"); registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration"); registry.add("spring.flyway.password", () -> "migration_test");
        registry.add("my-bill.export.directory", () -> EXPORT_DIRECTORY.toString());
    }

    @Test @Order(1) void prepareLargeTenantIsolatedDataset() throws Exception {
        deleteTree(EXPORT_DIRECTORY);
        jdbc.sql("INSERT INTO tenant(id) VALUES(:tenant),(:other)").param("tenant", TENANT).param("other", OTHER_TENANT).update();
        insertUser(USER, TENANT, "t18-user", "USER"); insertUser(OTHER_USER, OTHER_TENANT, "t18-other", "USER");
        insertUser(ADMIN, null, "t18-admin", "ADMIN");
        tenantDatabase.execute(TENANT, () -> { seedTenant(EXPENSE, INCOME, ADJUSTMENT, "=公式账单"); return null; });
        tenantDatabase.execute(OTHER_TENANT, () -> { seedExpense(FOREIGN, "其他租户秘密"); return null; });
        user = login("t18-user"); other = login("t18-other"); admin = login("t18-admin");
    }

    @Test @Order(2) void filteredExportFreezesFiltersStreamsCsvAndProtectsFormulaCells() throws Exception {
        JsonNode created = create(user, "filtered-export", Map.of(
                "scope", "CURRENT_FILTERS", "type", "EXPENSE", "lifecycle", "ACTIVE", "range", "CUSTOM",
                "startDate", "2026-09-07", "endDate", "2026-09-07", "query", "公式账单"), 200);
        UUID id = UUID.fromString(created.path("id").asText());
        assertThat(create(user, "filtered-export", Map.of(
                "scope", "CURRENT_FILTERS", "type", "EXPENSE", "lifecycle", "ACTIVE", "range", "CUSTOM",
                "startDate", "2026-09-07", "endDate", "2026-09-07", "query", "公式账单"), 200).path("id").asText())
                .isEqualTo(id.toString());
        runUntilFinished(generateRun(id));
        JsonNode done = exportStatus(user, id, 200);
        assertThat(done.path("status").asText()).isEqualTo("SUCCEEDED");
        assertThat(done.path("rowCount").asLong()).isEqualTo(1);
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT filter_snapshot->>'query' FROM export_job WHERE id=:id")
                .param("id", id).query(String.class).single())).isEqualTo("公式账单");

        MvcResult result = mockMvc.perform(get("/api/v1/exports/{id}/download", id).cookie(user))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Content-Type", "text/csv;charset=UTF-8"))
                .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("attachment"),
                        org.hamcrest.Matchers.containsString("2026-09-08.csv"))))
                .andReturn();
        byte[] bytes = result.getResponse().getContentAsByteArray();
        assertThat(bytes).startsWith((byte) 0xEF, (byte) 0xBB, (byte) 0xBF);
        String csv = new String(bytes, StandardCharsets.UTF_8);
        assertThat(csv).contains("\"记录ID\"", "\"'=公式账单\"", "\"2026-09-07T14:00:00.000000+08:00\"")
                .doesNotContain("其他租户秘密");
    }

    @Test @Order(3) void fullExportIncludesLargeDatasetIncomeAndAdjustmentLinkWithoutCrossTenantRows() throws Exception {
        JsonNode created = create(user, "all-data", Map.of("scope", "ALL_DATA"), 200);
        UUID id = UUID.fromString(created.path("id").asText());
        runUntilFinished(generateRun(id));
        JsonNode done = exportStatus(user, id, 200);
        assertThat(done.path("rowCount").asLong()).isEqualTo(1003);
        String csv = mockMvc.perform(get("/api/v1/exports/{id}/download", id).cookie(user))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(csv).contains("\"INCOME\"", "\"ADJUSTMENT\"", "\"REFUND\"", "\"" + EXPENSE + "\"")
                .doesNotContain("其他租户秘密");
    }

    @Test @Order(4) void pendingCancellationProducesNoFileAndPermissionsFailClosed() throws Exception {
        UUID cancelled = UUID.fromString(create(user, "cancelled", Map.of("scope", "ALL_DATA"), 200).path("id").asText());
        mockMvc.perform(post("/api/v1/exports/{id}/cancel", cancelled).with(csrf()).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT file_location FROM export_job WHERE id=:id")
                .param("id", cancelled).query(String.class).optional())).isEmpty();

        UUID foreignExport = UUID.fromString(create(other, "foreign", Map.of("scope", "ALL_DATA"), 200).path("id").asText());
        exportStatus(user, foreignExport, 404);
        mockMvc.perform(post("/api/v1/exports").with(csrf()).cookie(admin).header("Idempotency-Key", "admin")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"scope\":\"ALL_DATA\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/exports/{id}", foreignExport)).andExpect(status().isUnauthorized());
    }

    @Test @Order(5) void expiredDownloadIsDeniedAndCleanupRemovesTheFile() throws Exception {
        UUID id = UUID.fromString(create(user, "expiry", Map.of("scope", "ALL_DATA"), 200).path("id").asText());
        runUntilFinished(generateRun(id));
        String location = tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT file_location FROM export_job WHERE id=:id")
                .param("id", id).query(String.class).single());
        assertThat(Path.of(location)).exists();
        clock.advance(Duration.ofMinutes(6));
        mockMvc.perform(get("/api/v1/exports/{id}/download", id).cookie(user))
                .andExpect(status().isGone()).andExpect(jsonPath("$.code").value("EXPORT_EXPIRED"));
        runUntilFinished(purgeRun(id));
        assertThat(Path.of(location)).doesNotExist();
        assertThat(exportStatus(user, id, 200).path("status").asText()).isEqualTo("EXPIRED");
    }

    @AfterAll void cleanup() throws Exception {
        // 数据库属于本命令的一次性集群并在进程结束时整体销毁；这里只清理由测试创建的文件。
        deleteTree(EXPORT_DIRECTORY);
    }

    private JsonNode create(Cookie cookie, String key, Map<String, ?> body, int expected) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/exports").with(csrf()).cookie(cookie).header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsBytes(body)))
                .andExpect(status().is(expected)).andReturn();
        return mapper.readTree(result.getResponse().getContentAsByteArray());
    }
    private JsonNode exportStatus(Cookie cookie, UUID id, int expected) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/exports/{id}", id).cookie(cookie)).andExpect(status().is(expected)).andReturn();
        return mapper.readTree(result.getResponse().getContentAsByteArray());
    }
    private UUID generateRun(UUID id) { return run(id, PersonalExportJob.TYPE); }
    private UUID purgeRun(UUID id) { return run(id, ExpiredExportPurgeJob.TYPE); }
    private UUID run(UUID id, String type) {
        return jdbc.sql("SELECT id FROM job_run WHERE tenant_id=:tenant AND job_type=:type AND batch_key=:key")
                .param("tenant", TENANT).param("type", type).param("key", id.toString()).query(UUID.class).single();
    }
    private void runUntilFinished(UUID runId) {
        for (int attempt = 0; attempt < 30; attempt++) {
            String state = jdbc.sql("SELECT status FROM job_run WHERE id=:id").param("id", runId).query(String.class).single();
            if (state.equals("SUCCEEDED") || state.equals("CANCELLED")) return;
            assertThat(state).isIn("PENDING", "RUNNING"); assertThat(jobs.runNext()).isTrue();
        }
        throw new AssertionError("export job did not finish");
    }
    private Cookie login(String username) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsBytes(Map.of("username", username, "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("MY_BILL_SESSION");
    }
    private void insertUser(UUID id, UUID tenant, String username, String role) {
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,:username,:password,:role,:tenant)")
                .param("id", id).param("username", username).param("password", passwordEncoder.encode(PASSWORD))
                .param("role", role).param("tenant", tenant).update();
    }
    private void seedTenant(UUID expense, UUID income, UUID adjustment, String expenseName) {
        seedExpense(expense, expenseName);
        UUID payer = uuid("18500000-0000-4000-8000-000000000001"), incomeCategory = uuid("18500000-0000-4000-8000-000000000002");
        dictionary("payer", payer, "客户甲"); dictionary("income_category", incomeCategory, "项目收入");
        UUID funding = uuid("18500000-0000-4000-8000-000000000013");
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot,note)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-07T15:00:00+08:00','2026-09-07','顾问收入',
                  :payer,'客户甲',:category,'项目收入',800.00,:funding,'银行卡','收入备注')
                """).param("id", income).param("payer", payer).param("category", incomeCategory).param("funding", funding).update();
        jdbc.sql("""
                INSERT INTO expense_adjustment(tenant_id,id,original_expense_id,adjustment_type,amount,business_time,business_date,note)
                VALUES(current_setting('app.tenant_id')::uuid,:id,:expense,'REFUND',10.00,'2026-09-07T16:00:00+08:00','2026-09-07','退款备注')
                """).param("id", adjustment).param("expense", expense).update();
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot)
                SELECT current_setting('app.tenant_id')::uuid,('18300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
                  'EXPENSE','2026-09-07T12:00:00+08:00'::timestamptz + i * interval '1 second','2026-09-07',
                  :product,'批量账目',:category,'餐饮',:unit,'次',1.00,1,1.00,1.00,:funding,'银行卡'
                FROM generate_series(100,1099) AS i
                """).param("product", uuid("18500000-0000-4000-8000-000000000010"))
                .param("category", uuid("18500000-0000-4000-8000-000000000011"))
                .param("unit", uuid("18500000-0000-4000-8000-000000000012"))
                .param("funding", funding).update();
    }
    private void seedExpense(UUID id, String name) {
        UUID product = uuid("18500000-0000-4000-8000-000000000010"), category = uuid("18500000-0000-4000-8000-000000000011");
        UUID unit = uuid("18500000-0000-4000-8000-000000000012"), funding = uuid("18500000-0000-4000-8000-000000000013");
        dictionary("expense_category", category, "餐饮"); dictionary("unit", unit, "次"); dictionary("funding_channel", funding, "银行卡");
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", product).param("name", name).update();
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot,note)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE','2026-09-07T14:00:00+08:00','2026-09-07',
                  :product,:name,:category,'餐饮',:unit,'次',100.00,1,100.00,100.00,:funding,'银行卡','=SUM(A1:A2)')
                """).param("id", id).param("product", product).param("name", name).param("category", category)
                .param("unit", unit).param("funding", funding).update();
    }
    private void dictionary(String table, UUID id, String name) {
        jdbc.sql("INSERT INTO " + table + "(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE') ON CONFLICT DO NOTHING")
                .param("id", id).param("name", name).update();
    }
    private static void deleteTree(Path root) throws Exception {
        if (!Files.exists(root)) return;
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }
    private static UUID uuid(String value) { return UUID.fromString(value); }

    @TestConfiguration static class ClockConfiguration {
        @Bean @Primary MutableClock mutableExportClock() {
            return new MutableClock(Instant.parse("2026-09-07T16:00:00Z"));
        }
    }
    static final class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant now) { this.now = now; }
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
