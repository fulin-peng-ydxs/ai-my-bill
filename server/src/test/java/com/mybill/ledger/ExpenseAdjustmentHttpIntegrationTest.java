package com.mybill.ledger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t16-adjustment-rate-limit-pepper", "my-bill.schema.validation-enabled=false"})
@AutoConfigureMockMvc
@Import(ExpenseAdjustmentHttpIntegrationTest.FixedClockConfiguration.class)
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ExpenseAdjustmentHttpIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-09-07T06:00:00Z");
    private static final UUID TENANT = UUID.fromString("16100000-0000-4000-8000-000000000001");
    private static final UUID OTHER = UUID.fromString("16100000-0000-4000-8000-000000000002");
    private static final UUID USER = UUID.fromString("16200000-0000-4000-8000-000000000001");
    private static final UUID ADMIN = UUID.fromString("16200000-0000-4000-8000-000000000002");
    private static final UUID EXPENSE = UUID.fromString("16300000-0000-4000-8000-000000000001");
    private static final UUID CONCURRENT_EXPENSE = UUID.fromString("16300000-0000-4000-8000-000000000002");
    private static final UUID INCOME = UUID.fromString("16300000-0000-4000-8000-000000000003");
    private static final String PASSWORD = "T16-Formal-Password-2026";
    @Autowired MockMvc mockMvc; @Autowired ObjectMapper mapper; @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder; @Autowired TenantDatabaseExecutor tenantDatabase;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url); registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test"); registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration"); registry.add("spring.flyway.password", () -> "migration_test");
    }

    @Test @Order(1) void prepare() {
        jdbc.sql("INSERT INTO tenant(id) VALUES(:tenant),(:other)").param("tenant", TENANT).param("other", OTHER).update();
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,'t16-user',:password,'USER',:tenant)")
                .param("id", USER).param("password", passwordEncoder.encode(PASSWORD)).param("tenant", TENANT).update();
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role) VALUES(:id,'t16-admin',:password,'ADMIN')")
                .param("id", ADMIN).param("password", passwordEncoder.encode(PASSWORD)).update();
        tenantDatabase.execute(TENANT, () -> { insertExpense(EXPENSE, "电影票", "100.00"); insertExpense(CONCURRENT_EXPENSE, "并发支出", "100.00"); insertIncome(); return null; });
        tenantDatabase.execute(OTHER, () -> { insertExpense(UUID.fromString("16300000-0000-4000-8000-000000000099"), "他人支出", "100.00"); return null; });
    }

    @Test @Order(2) void supportsPartialMultipleExactAndUnifiedQuery() throws Exception {
        Cookie user = login();
        JsonNode first = create(user, EXPENSE, "partial-refund", "REFUND", "30.00", 201);
        assertThat(first.path("netExpenseAmount").asText()).isEqualTo("70.00");
        JsonNode second = create(user, EXPENSE, "exact-reimbursement", "REIMBURSEMENT", "70.00", 201);
        assertThat(second.path("fullyAdjusted").asBoolean()).isTrue();
        assertThat(second.path("effectiveAdjustmentAmount").asText()).isEqualTo("100.00");
        JsonNode page = json(mockMvc.perform(get("/api/v1/ledger-entries").cookie(user)
                .queryParam("type", "ADJUSTMENT")).andExpect(status().isOk()).andReturn());
        assertThat(page.path("items")).hasSize(2);
        assertThat(page.path("items").get(0).path("entryType").asText()).isEqualTo("ADJUSTMENT");
        JsonNode all = json(mockMvc.perform(get("/api/v1/ledger-entries").cookie(user)
                .queryParam("query", "电影票")).andExpect(status().isOk()).andReturn());
        assertThat(all.path("items")).hasSize(3);
        JsonNode source = findItem(all, EXPENSE);
        assertThat(source.path("netExpenseAmount").asText()).isEqualTo("0.00");
        assertThat(source.path("fullyAdjusted").asBoolean()).isTrue();
    }

    @Test @Order(3) void rejectsOverCapIncomeAndForeignSources() throws Exception {
        Cookie user = login();
        mockMvc.perform(post("/api/v1/ledger-entries/{id}/adjustments", EXPENSE).with(csrf()).cookie(user)
                .header("Idempotency-Key", "over-cap").contentType(MediaType.APPLICATION_JSON)
                .content(request("REFUND", "0.01"))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ADJUSTMENT_EXCEEDS_EXPENSE"))
                .andExpect(jsonPath("$.fieldErrors.amount[0]").value("当前最多还可调整 ¥0.00。"));
        for (UUID invalid : List.of(INCOME, UUID.fromString("16300000-0000-4000-8000-000000000099"))) {
            mockMvc.perform(post("/api/v1/ledger-entries/{id}/adjustments", invalid).with(csrf()).cookie(user)
                    .header("Idempotency-Key", "invalid-" + invalid).contentType(MediaType.APPLICATION_JSON)
                    .content(request("REFUND", "1.00"))).andExpect(status().isNotFound());
        }
        JsonNode page = json(mockMvc.perform(get("/api/v1/ledger-entries").cookie(user)
                .queryParam("type", "ADJUSTMENT")).andExpect(status().isOk()).andReturn());
        String adjustmentId = page.path("items").get(0).path("id").asText();
        mockMvc.perform(get("/api/v1/adjustments/{id}", adjustmentId))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/adjustments/{id}", adjustmentId).cookie(login("t16-admin")))
                .andExpect(status().isForbidden());
    }

    @Test @Order(4) void revokePreservesHistoryAndRestoresNetExpense() throws Exception {
        Cookie user = login();
        JsonNode page = json(mockMvc.perform(get("/api/v1/ledger-entries").cookie(user)
                .queryParam("type", "ADJUSTMENT")).andExpect(status().isOk()).andReturn());
        JsonNode adjustment = page.path("items").get(0);
        JsonNode detail = json(mockMvc.perform(get("/api/v1/adjustments/{id}", adjustment.path("id").asText())
                .cookie(user)).andExpect(status().isOk()).andReturn());
        JsonNode revoked = json(mockMvc.perform(post("/api/v1/adjustments/{id}/revoke", detail.path("id").asText())
                .with(csrf()).cookie(user).header("Idempotency-Key", "revoke-once")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("version", detail.path("version").asLong()))))
                .andExpect(status().isOk()).andReturn());
        assertThat(revoked.path("status").asText()).isEqualTo("REVOKED");
        BigDecimal revokedAmount = new BigDecimal(detail.path("amount").asText());
        assertThat(revoked.path("effectiveAdjustmentAmount").asText())
                .isEqualTo(new BigDecimal("100.00").subtract(revokedAmount).setScale(2).toPlainString());
        assertThat(revoked.path("netExpenseAmount").asText()).isEqualTo(revokedAmount.setScale(2).toPlainString());
        JsonNode replay = json(mockMvc.perform(post("/api/v1/adjustments/{id}/revoke", detail.path("id").asText())
                .with(csrf()).cookie(user).header("Idempotency-Key", "revoke-once")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("version", detail.path("version").asLong()))))
                .andExpect(status().isOk()).andReturn());
        assertThat(replay.path("version").asLong()).isEqualTo(1);
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM expense_adjustment WHERE id=:id AND status='REVOKED'")
                .param("id", UUID.fromString(detail.path("id").asText())).query(Long.class).single())).isOne();
    }

    @Test @Order(5) void concurrentRequestsCannotExceedSourceAmount() throws Exception {
        Cookie user = login(); CountDownLatch ready = new CountDownLatch(2); CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var futures = List.of(executor.submit(() -> concurrentCreate(user, "concurrent-a", ready, start)),
                    executor.submit(() -> concurrentCreate(user, "concurrent-b", ready, start)));
            ready.await(); start.countDown();
            List<Integer> statuses = List.of(futures.get(0).get(), futures.get(1).get());
            assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        }
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT sum(amount) FROM expense_adjustment WHERE original_expense_id=:id AND status='EFFECTIVE'")
                .param("id", CONCURRENT_EXPENSE).query(String.class).single())).isEqualTo("60.00");
    }

    private int concurrentCreate(Cookie user, String key, CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown(); start.await();
        return mockMvc.perform(post("/api/v1/ledger-entries/{id}/adjustments", CONCURRENT_EXPENSE).with(csrf()).cookie(user)
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(request("REFUND", "60.00")))
                .andReturn().getResponse().getStatus();
    }

    private JsonNode create(Cookie user, UUID expense, String key, String type, String amount, int status) throws Exception {
        return json(mockMvc.perform(post("/api/v1/ledger-entries/{id}/adjustments", expense).with(csrf()).cookie(user)
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(request(type, amount)))
                .andExpect(status().is(status)).andReturn());
    }

    private String request(String type, String amount) throws Exception {
        return mapper.writeValueAsString(Map.of("adjustmentType", type, "amount", amount,
                "occurredAt", "2026-09-07T05:00:00Z", "note", "T16 调整"));
    }

    private Cookie login() throws Exception {
        return login("t16-user");
    }

    private Cookie login(String username) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("username", username, "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn();
        return result.getResponse().getCookie("MY_BILL_SESSION");
    }

    private JsonNode json(MvcResult result) throws Exception { return mapper.readTree(result.getResponse().getContentAsByteArray()); }
    private JsonNode findItem(JsonNode page, UUID id) {
        for (JsonNode item : page.path("items")) if (id.toString().equals(item.path("id").asText())) return item;
        throw new AssertionError("item not found " + id);
    }

    private void insertExpense(UUID id, String title, String paid) {
        UUID product = UUID.randomUUID(), category = UUID.randomUUID(), unit = UUID.randomUUID(), funding = UUID.randomUUID();
        String categoryName = title + "分类", unitName = title + "单位", fundingName = title + "渠道";
        dictionary("expense_category", category, categoryName); dictionary("unit", unit, unitName);
        dictionary("funding_channel", funding, fundingName);
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", product).param("name", title).update();
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE','2026-09-07T13:00:00+08:00','2026-09-07',
                  :product,:title,:category,:categoryName,:unit,:unitName,:paid,1,:paid,:paid,:funding,:fundingName)
                """).param("id", id).param("product", product).param("title", title).param("category", category)
                .param("categoryName", categoryName).param("unit", unit).param("unitName", unitName)
                .param("paid", new BigDecimal(paid)).param("funding", funding).param("fundingName", fundingName).update();
    }

    private void insertIncome() {
        UUID payer = UUID.randomUUID(), category = UUID.randomUUID(), funding = UUID.randomUUID();
        dictionary("payer", payer, "公司"); dictionary("income_category", category, "工资"); dictionary("funding_channel", funding, "现金");
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-07T13:00:00+08:00','2026-09-07',
                  '工资',:payer,'公司',:category,'工资',100,:funding,'现金')
                """).param("id", INCOME).param("payer", payer).param("category", category).param("funding", funding).update();
    }

    private void dictionary(String table, UUID id, String name) {
        jdbc.sql("INSERT INTO " + table + "(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", id).param("name", name).update();
    }

    @TestConfiguration static class FixedClockConfiguration {
        @Bean @Primary Clock fixedAdjustmentClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
    }
}
