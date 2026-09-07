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
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t14-query-pepper", "my-bill.schema.validation-enabled=false"})
@AutoConfigureMockMvc
@Import(LedgerQueryHttpIntegrationTest.FixedClockConfiguration.class)
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class LedgerQueryHttpIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-09-07T04:00:00Z");
    private static final UUID TENANT = uuid("b1000000-0000-4000-8000-000000000001");
    private static final UUID OTHER = uuid("b1000000-0000-4000-8000-000000000002");
    private static final UUID USER = uuid("b2000000-0000-4000-8000-000000000001");
    private static final UUID PRODUCT = uuid("b3000000-0000-4000-8000-000000000001");
    private static final UUID CATEGORY = uuid("b4000000-0000-4000-8000-000000000001");
    private static final UUID UNIT = uuid("b5000000-0000-4000-8000-000000000001");
    private static final UUID FUNDING_A = uuid("b6000000-0000-4000-8000-000000000001");
    private static final UUID FUNDING_B = uuid("b6000000-0000-4000-8000-000000000002");
    private static final UUID PAYER = uuid("b7000000-0000-4000-8000-000000000001");
    private static final UUID INCOME_CATEGORY = uuid("b8000000-0000-4000-8000-000000000001");
    private static final String PASSWORD = "T14-Formal-Password-2026";
    @Autowired MockMvc mockMvc; @Autowired ObjectMapper objectMapper; @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder; @Autowired TenantDatabaseExecutor tenantDatabase;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url); registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test"); registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration"); registry.add("spring.flyway.password", () -> "migration_test");
    }

    @Test @Order(1) void prepare() {
        jdbc.sql("INSERT INTO tenant(id) VALUES(:tenant),(:other)").param("tenant", TENANT).param("other", OTHER).update();
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,'t14-user',:password,'USER',:tenant)")
                .param("id", USER).param("password", passwordEncoder.encode(PASSWORD)).param("tenant", TENANT).update();
        tenantDatabase.execute(TENANT, () -> { prepareDictionaries(); for (int index = 1; index <= 25; index++) entry(index); specialIncome(); return null; });
        tenantDatabase.execute(OTHER, () -> { prepareForeign(); return null; });
    }

    @Test @Order(2) void paginatesWithStableCursorWhileNewRowsArrive() throws Exception {
        Cookie user = login(); JsonNode first = getPage(user, Map.of());
        assertThat(first.path("items").size()).isEqualTo(20);
        assertThat(first.path("hasMore").asBoolean()).isTrue();
        assertThat(first.path("items").get(0).path("id").asText()).endsWith("000025");
        Set<String> ids = new HashSet<>(); first.path("items").forEach(item -> ids.add(item.path("id").asText()));
        tenantDatabase.execute(TENANT, () -> { entry(26); return null; });
        JsonNode second = getPage(user, Map.of("cursor", first.path("nextCursor").asText()));
        assertThat(second.path("items").size()).isEqualTo(5);
        assertThat(second.path("hasMore").asBoolean()).isFalse();
        second.path("items").forEach(item -> assertThat(ids.add(item.path("id").asText())).isTrue());
        assertThat(ids).hasSize(25).doesNotContain(entryId(26).toString());
    }

    @Test @Order(3) void combinesLiteralKeywordTypeFundingAndCustomDate() throws Exception {
        Cookie user = login();
        JsonNode filtered = getPage(user, Map.of("type", "INCOME", "fundingChannelId", FUNDING_B.toString(),
                "range", "CUSTOM", "startDate", "2026-09-06", "endDate", "2026-09-06", "query", "100_奖励"));
        assertThat(filtered.path("items")).hasSize(1);
        assertThat(filtered.path("items").get(0).path("title").asText()).isEqualTo("100_奖励");
        assertThat(filtered.path("items").get(0).path("amount").asText()).isEqualTo("88.80");
        JsonNode wildcard = getPage(user, Map.of("range", "CUSTOM", "startDate", "2026-09-06",
                "endDate", "2026-09-06", "query", "%"));
        assertThat(wildcard.path("items")).isEmpty();
    }

    @Test @Order(4) void rejectsInvalidBoundsAndCursorAndHidesForeignRows() throws Exception {
        Cookie user = login();
        mockMvc.perform(get("/api/v1/ledger-entries").queryParam("range", "CUSTOM")
                .queryParam("startDate", "2026-09-07").queryParam("endDate", "2026-09-06").cookie(user))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.startDate[0]").exists());
        mockMvc.perform(get("/api/v1/ledger-entries").queryParam("cursor", "not-a-cursor").cookie(user))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.cursor[0]").exists());
        JsonNode page = getPage(user, Map.of("query", "其他租户机密"));
        assertThat(page.path("items")).isEmpty();
    }

    @Test @Order(5) void listedActiveEntryCanUseT13DailyContextContract() throws Exception {
        Cookie user = login(); JsonNode page = getPage(user, Map.of("query", "商品 01"));
        String id = page.path("items").get(0).path("id").asText();
        mockMvc.perform(put("/api/v1/ledger-entries/{id}/daily-template", id).with(csrf()).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.entryType").value("EXPENSE"))
                .andExpect(jsonPath("$.displayName").value("基础商品"));
    }

    @Test @Order(6) void activeDateCursorQueryCanUsePreparedIndex() {
        String plan = tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("SET LOCAL enable_seqscan=off").update();
            return String.join("\n", jdbc.sql("""
                    EXPLAIN SELECT id FROM ledger_entry
                    WHERE lifecycle_status='ACTIVE' AND business_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-07'
                    ORDER BY business_date DESC,business_time DESC,created_at DESC,id DESC LIMIT 21
                    """).query(String.class).list());
        });
        assertThat(plan).contains("idx_ledger_active_cursor");
    }

    private JsonNode getPage(Cookie user, Map<String,String> params) throws Exception {
        var request = get("/api/v1/ledger-entries").cookie(user);
        for (Map.Entry<String,String> entry : params.entrySet()) request.queryParam(entry.getKey(), entry.getValue());
        MvcResult result = mockMvc.perform(request).andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private void prepareDictionaries() {
        dictionary("expense_category", CATEGORY, "餐饮"); dictionary("unit", UNIT, "个");
        dictionary("funding_channel", FUNDING_A, "银行卡"); dictionary("funding_channel", FUNDING_B, "现金");
        dictionary("payer", PAYER, "客户甲"); dictionary("income_category", INCOME_CATEGORY, "奖金");
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,'基础商品','基础商品','ACTIVE')")
                .param("id", PRODUCT).update();
    }

    private void entry(int index) {
        boolean expense = index % 2 == 1; UUID id = entryId(index);
        if (expense) jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot,note,created_at,updated_at)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE','2026-09-07T08:00:00+08:00','2026-09-07',
                  :product,:name,:category,'餐饮',:unit,'个',10,1,10,10,:funding,:fundingName,:note,
                  '2026-09-07T00:00:00Z','2026-09-07T00:00:00Z')
                """).param("id", id).param("product", PRODUCT).param("name", String.format("商品 %02d", index))
                .param("category", CATEGORY).param("unit", UNIT).param("funding", FUNDING_A)
                .param("fundingName", "银行卡").param("note", "早餐").update();
        else jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot,
                  note,created_at,updated_at)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-07T08:00:00+08:00','2026-09-07',
                  :name,:payer,'客户甲',:category,'奖金',20,:funding,'现金','到账',
                  '2026-09-07T00:00:00Z','2026-09-07T00:00:00Z')
                """).param("id", id).param("name", String.format("收入 %02d", index)).param("payer", PAYER)
                .param("category", INCOME_CATEGORY).param("funding", FUNDING_B).update();
    }

    private void specialIncome() {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-06T23:59:59+08:00','2026-09-06',
                  '100_奖励',:payer,'客户甲',:category,'奖金',88.80,:funding,'现金')
                """).param("id", uuid("b9000000-0000-4000-8000-000000000099")).param("payer", PAYER)
                .param("category", INCOME_CATEGORY).param("funding", FUNDING_B).update();
    }

    private void prepareForeign() {
        UUID payer = uuid("b7000000-0000-4000-8000-000000000002"); UUID category = uuid("b8000000-0000-4000-8000-000000000002");
        UUID funding = uuid("b6000000-0000-4000-8000-000000000003");
        dictionary("payer", payer, "外部付款方"); dictionary("income_category", category, "外部分类"); dictionary("funding_channel", funding, "外部渠道");
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-07T08:00:00+08:00','2026-09-07',
                  '其他租户机密',:payer,'外部付款方',:category,'外部分类',999,:funding,'外部渠道')
                """).param("id", uuid("b9000000-0000-4000-8000-000000000098")).param("payer", payer)
                .param("category", category).param("funding", funding).update();
    }

    private void dictionary(String table, UUID id, String name) {
        jdbc.sql("INSERT INTO " + table + "(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", id).param("name", name).update();
    }

    private Cookie login() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("username", "t14-user", "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn();
        return result.getResponse().getCookie("MY_BILL_SESSION");
    }

    private static UUID entryId(int index) { return uuid(String.format("b9000000-0000-4000-8000-%012d", index)); }
    private static UUID uuid(String value) { return UUID.fromString(value); }

    @TestConfiguration static class FixedClockConfiguration {
        @Bean @Primary Clock fixedLedgerQueryClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
    }
}
