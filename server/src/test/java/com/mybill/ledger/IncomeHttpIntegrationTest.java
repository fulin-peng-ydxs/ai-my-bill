package com.mybill.ledger;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t12-income-rate-limit-pepper", "my-bill.schema.validation-enabled=false"})
@AutoConfigureMockMvc
@Import(IncomeHttpIntegrationTest.FixedClockConfiguration.class)
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class IncomeHttpIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-09-06T12:00:00Z");
    private static final UUID TENANT = UUID.fromString("f1000000-0000-4000-8000-000000000001");
    private static final UUID OTHER = UUID.fromString("f1000000-0000-4000-8000-000000000002");
    private static final UUID USER = UUID.fromString("f2000000-0000-4000-8000-000000000001");
    private static final UUID PAYER = UUID.fromString("f3000000-0000-4000-8000-000000000001");
    private static final UUID FOREIGN_PAYER = UUID.fromString("f3000000-0000-4000-8000-000000000002");
    private static final UUID FOREIGN_ENTRY = UUID.fromString("f6000000-0000-4000-8000-000000000002");
    private static final UUID CATEGORY = UUID.fromString("f4000000-0000-4000-8000-000000000001");
    private static final UUID FUNDING = UUID.fromString("f5000000-0000-4000-8000-000000000001");
    private static final String PASSWORD = "T12-Formal-Password-2026";
    @Autowired MockMvc mockMvc; @Autowired ObjectMapper objectMapper; @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder; @Autowired TenantDatabaseExecutor tenantDatabase;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url); registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test"); registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration"); registry.add("spring.flyway.password", () -> "migration_test");
    }

    @Test @Order(1) void prepare() {
        jdbc.sql("INSERT INTO tenant(id) VALUES (:tenant),(:other)").param("tenant", TENANT).param("other", OTHER).update();
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,'t12-user',:password,'USER',:tenant)")
                .param("id", USER).param("password", passwordEncoder.encode(PASSWORD)).param("tenant", TENANT).update();
        tenantDatabase.execute(TENANT, () -> { dictionary("payer", PAYER, "客户甲"); dictionary("income_category", CATEGORY, "稿费");
            dictionary("funding_channel", FUNDING, "银行卡"); return null; });
        tenantDatabase.execute(OTHER, () -> {
            dictionary("payer", FOREIGN_PAYER, "其他租户付款方");
            dictionary("income_category", CATEGORY, "其他租户分类");
            dictionary("funding_channel", FUNDING, "其他租户渠道");
            jdbc.sql("""
                    INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,
                      payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,income_amount,
                      funding_channel_id,funding_channel_name_snapshot)
                    VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME',:time,'2026-09-06','隔离收入',
                      :payer,'其他租户付款方',:category,'其他租户分类',10,:funding,'其他租户渠道')
                    """).param("id", FOREIGN_ENTRY).param("time", java.sql.Timestamp.from(NOW))
                    .param("payer", FOREIGN_PAYER).param("category", CATEGORY).param("funding", FUNDING).update();
            return null;
        });
    }

    @Test @Order(2) void createsPreciseDuplicateNamedIncomeAndReplaysSameRequest() throws Exception {
        Cookie user = login(); Map<String,Object> body = request(PAYER, "技术稿费", "123.40", NOW.plusSeconds(299));
        MvcResult created = mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "income-key")
                .contentType(MediaType.APPLICATION_JSON).content(json(body))).andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value("123.40")).andExpect(jsonPath("$.incomeName").value("技术稿费")).andReturn();
        String id = objectMapper.readTree(created.getResponse().getContentAsByteArray()).path("id").asText();
        mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "income-key")
                .contentType(MediaType.APPLICATION_JSON).content(json(body))).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "income-key-2")
                .contentType(MediaType.APPLICATION_JSON).content(json(body))).andExpect(status().isCreated());
        mockMvc.perform(get("/api/v1/incomes/names").queryParam("query", "技术").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1));
    }

    @Test @Order(3) void rejectsInvalidAmountForeignReferenceAndTooFutureTime() throws Exception {
        Cookie user = login();
        mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "zero")
                .contentType(MediaType.APPLICATION_JSON).content(json(request(PAYER,"工资","0",NOW))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.amount[0]").exists());
        mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "foreign")
                .contentType(MediaType.APPLICATION_JSON).content(json(request(FOREIGN_PAYER,"工资","1",NOW))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.payerId[0]").exists());
        mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "future")
                .contentType(MediaType.APPLICATION_JSON).content(json(request(PAYER,"工资","1",NOW.plusSeconds(301)))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.occurredAt[0]").exists());
    }

    @Test @Order(4) void concurrentSameKeyCreatesExactlyOneIncome() throws Exception {
        Cookie user = login(); String body = json(request(PAYER,"并发奖金","66.60",NOW));
        CountDownLatch ready = new CountDownLatch(2); CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<MvcResult>> futures = List.of(executor.submit(() -> concurrentCreate(user, body, ready, start)),
                    executor.submit(() -> concurrentCreate(user, body, ready, start)));
            ready.await(); start.countDown();
            MvcResult first = futures.get(0).get(); MvcResult second = futures.get(1).get();
            assertThat(List.of(first.getResponse().getStatus(), second.getResponse().getStatus()))
                    .containsExactlyInAnyOrder(200, 201);
            String firstId = objectMapper.readTree(first.getResponse().getContentAsByteArray()).path("id").asText();
            String secondId = objectMapper.readTree(second.getResponse().getContentAsByteArray()).path("id").asText();
            assertThat(firstId).isEqualTo(secondId);
        }
    }

    @Test @Order(5) void undoRequiresOriginalKeyAndAllowsFreshSave() throws Exception {
        Cookie user = login(); Map<String,Object> body = request(PAYER,"退款","20.00",NOW);
        MvcResult created = mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "undo-income")
                .contentType(MediaType.APPLICATION_JSON).content(json(body))).andExpect(status().isCreated()).andReturn();
        String id = objectMapper.readTree(created.getResponse().getContentAsByteArray()).path("id").asText();
        mockMvc.perform(delete("/api/v1/incomes/{id}/undo", id).with(csrf()).cookie(user).header("Idempotency-Key", "wrong"))
                .andExpect(status().isConflict());
        mockMvc.perform(delete("/api/v1/incomes/{id}/undo", id).with(csrf()).cookie(user).header("Idempotency-Key", "undo-income"))
                .andExpect(status().isNoContent());
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM ledger_entry WHERE id=:id")
                .param("id", UUID.fromString(id)).query(Long.class).single())).isZero();
        mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "undo-income")
                .contentType(MediaType.APPLICATION_JSON).content(json(body))).andExpect(status().isCreated());
    }

    @Test @Order(6) void detailAndUpdateAreIdempotentAndOptimisticallyLocked() throws Exception {
        Cookie user = login(); Map<String,Object> body = request(PAYER,"项目奖金","80.00",NOW.minusSeconds(60));
        MvcResult created = mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user)
                .header("Idempotency-Key", "income-edit-create").contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.version").value(0)).andReturn();
        String id = objectMapper.readTree(created.getResponse().getContentAsByteArray()).path("id").asText();
        mockMvc.perform(get("/api/v1/incomes/{id}", id).cookie(user)).andExpect(status().isOk())
                .andExpect(jsonPath("$.incomeName").value("项目奖金"));
        tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("UPDATE payer SET display_name='客户乙',normalized_name='客户乙' WHERE id=:id").param("id", PAYER).update();
            jdbc.sql("UPDATE income_category SET display_name='奖金',normalized_name='奖金' WHERE id=:id").param("id", CATEGORY).update();
            jdbc.sql("UPDATE funding_channel SET display_name='工资卡',normalized_name='工资卡' WHERE id=:id").param("id", FUNDING).update();
            return null;
        });
        Map<String,Object> changed = new LinkedHashMap<>(body); changed.put("incomeName", "年度奖金");
        changed.put("amount", "88.80"); changed.put("occurredAt", NOW.minusSeconds(86_400)); changed.put("note", "  已确认  ");
        Map<String,Object> update = Map.of("version", 0, "entry", changed);
        mockMvc.perform(put("/api/v1/incomes/{id}", id).with(csrf()).cookie(user).header("Idempotency-Key", "income-edit-key")
                .contentType(MediaType.APPLICATION_JSON).content(json(update))).andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1)).andExpect(jsonPath("$.amount").value("88.80"))
                .andExpect(jsonPath("$.payerName").value("客户乙"))
                .andExpect(jsonPath("$.incomeCategoryName").value("奖金"))
                .andExpect(jsonPath("$.fundingChannelName").value("工资卡"))
                .andExpect(jsonPath("$.businessDate").value("2026-09-05"))
                .andExpect(jsonPath("$.note").value("已确认"));
        mockMvc.perform(put("/api/v1/incomes/{id}", id).with(csrf()).cookie(user).header("Idempotency-Key", "income-edit-key")
                .contentType(MediaType.APPLICATION_JSON).content(json(update))).andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(put("/api/v1/incomes/{id}", id).with(csrf()).cookie(user).header("Idempotency-Key", "income-stale")
                .contentType(MediaType.APPLICATION_JSON).content(json(update))).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LEDGER_VERSION_CONFLICT"));
        Map<String,Object> invalid = new LinkedHashMap<>(changed); invalid.put("amount", "0");
        mockMvc.perform(put("/api/v1/incomes/{id}", id).with(csrf()).cookie(user).header("Idempotency-Key", "income-invalid")
                .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("version",1,"entry",invalid))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.amount[0]").exists());
        mockMvc.perform(put("/api/v1/incomes/{id}", id).with(csrf()).cookie(user).header("Idempotency-Key", "income-negative-version")
                .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("version",-1,"entry",changed))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.version[0]").exists());
        mockMvc.perform(get("/api/v1/incomes/{id}", id).cookie(user)).andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1)).andExpect(jsonPath("$.incomeName").value("年度奖金"));
        mockMvc.perform(get("/api/v1/ledger-entries").queryParam("range", "THIS_YEAR")
                .queryParam("query", "年度奖金").cookie(user)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(id)).andExpect(jsonPath("$.items[0].amount").value("88.80"));
        mockMvc.perform(get("/api/v1/incomes/{id}", UUID.randomUUID()).cookie(user)).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LEDGER_ENTRY_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/incomes/{id}", FOREIGN_ENTRY).cookie(user)).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LEDGER_ENTRY_NOT_FOUND"));
        mockMvc.perform(put("/api/v1/incomes/{id}", FOREIGN_ENTRY).with(csrf()).cookie(user)
                .header("Idempotency-Key", "foreign-income-edit").contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("version",0,"entry",changed))))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("LEDGER_ENTRY_NOT_FOUND"));
    }

    private void dictionary(String table, UUID id, String name) { jdbc.sql("INSERT INTO " + table +
            "(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
            .param("id", id).param("name", name).update(); }
    private Map<String,Object> request(UUID payer, String name, String amount, Instant occurredAt) { Map<String,Object> body = new LinkedHashMap<>();
        body.put("incomeName", name); body.put("payerId", payer); body.put("incomeCategoryId", CATEGORY); body.put("amount", amount);
        body.put("fundingChannelId", FUNDING); body.put("occurredAt", occurredAt); body.put("note", "  到账  "); return body; }
    private Cookie login() throws Exception { MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf())
            .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("username","t12-user","password",PASSWORD))))
            .andExpect(status().isOk()).andReturn(); return result.getResponse().getCookie("MY_BILL_SESSION"); }
    private MvcResult concurrentCreate(Cookie user, String body, CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown(); start.await();
        return mockMvc.perform(post("/api/v1/incomes").with(csrf()).cookie(user).header("Idempotency-Key", "income-concurrent")
                .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn();
    }
    private String json(Object value) throws Exception { return objectMapper.writeValueAsString(value); }

    @TestConfiguration
    static class FixedClockConfiguration {
        @Bean @Primary Clock fixedIncomeClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
    }
}
