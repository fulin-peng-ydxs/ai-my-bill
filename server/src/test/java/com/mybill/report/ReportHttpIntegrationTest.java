package com.mybill.report;

import com.fasterxml.jackson.databind.JsonNode;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t20-report-pepper", "my-bill.schema.validation-enabled=false"})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ReportHttpIntegrationTest {
    private static final UUID TENANT = uuid("20100000-0000-4000-8000-000000000001");
    private static final UUID OTHER = uuid("20100000-0000-4000-8000-000000000002");
    private static final UUID USER = uuid("20200000-0000-4000-8000-000000000001");
    private static final UUID ADMIN = uuid("20200000-0000-4000-8000-000000000002");
    private static final UUID EXPENSE = uuid("20300000-0000-4000-8000-000000000001");
    private static final UUID PRODUCT = uuid("20400000-0000-4000-8000-000000000001");
    private static final UUID HISTORY_PRODUCT = uuid("20400000-0000-4000-8000-000000000007");
    private static final UUID QUALITY_PRODUCT = uuid("20400000-0000-4000-8000-000000000008");
    private static final UUID QUALITY_ENTRY = uuid("20300000-0000-4000-8000-000000000030");
    private static final UUID DUPLICATE_ENTRY = uuid("20300000-0000-4000-8000-000000000031");
    private static final UUID CATEGORY = uuid("20400000-0000-4000-8000-000000000002");
    private static final UUID UNIT = uuid("20400000-0000-4000-8000-000000000003");
    private static final UUID FUNDING = uuid("20400000-0000-4000-8000-000000000004");
    private static final UUID PAYER = uuid("20400000-0000-4000-8000-000000000005");
    private static final UUID INCOME_CATEGORY = uuid("20400000-0000-4000-8000-000000000006");
    private static final UUID STOPPED_PAYER = uuid("20400000-0000-4000-8000-000000000009");
    private static final UUID STOPPED_INCOME_CATEGORY = uuid("20400000-0000-4000-8000-000000000010");
    private static final UUID STOPPED_FUNDING = uuid("20400000-0000-4000-8000-000000000011");
    private static final String PASSWORD = "T20-Formal-Password-2026";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired TenantDatabaseExecutor tenantDatabase;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url); registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test"); registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration"); registry.add("spring.flyway.password", () -> "migration_test");
    }

    @Test @Order(1) void prepare() {
        jdbc.sql("INSERT INTO tenant(id) VALUES(:tenant),(:other)").param("tenant", TENANT).param("other", OTHER).update();
        user(USER, "t20-user", "USER", TENANT);
        jdbc.sql("UPDATE app_user SET created_at='2024-01-01T00:00:00Z' WHERE id=:id").param("id", USER).update();
        user(ADMIN, "t20-admin", "ADMIN", null);
        tenantDatabase.execute(TENANT, () -> { dictionaries(); expense(EXPENSE, "团队午餐", "100.00"); income(); incomeDimensions(); adjustment(); excludedAdjustments();
            comparisonHistory(); qualityHistory(); trashedIncome(); return null; });
        tenantDatabase.execute(OTHER, () -> { foreignIncome(); return null; });
    }

    @Test @Order(2) void aggregatesOneFilterSnapshotWithAdjustmentSemantics() throws Exception {
        JsonNode result = summary(login("t20-user"), Map.of("range", "CUSTOM", "startDate", "2026-09-01", "endDate", "2026-09-30"));
        assertThat(result.path("totalIncome").asText()).isEqualTo("250.00");
        assertThat(result.path("grossExpense").asText()).isEqualTo("100.00");
        assertThat(result.path("adjustmentAmount").asText()).isEqualTo("30.00");
        assertThat(result.path("netExpense").asText()).isEqualTo("70.00");
        assertThat(result.path("balance").asText()).isEqualTo("180.00");
        assertThat(result.path("matchingItemCount").asLong()).isEqualTo(3);
        assertThat(result.path("dataPoints")).hasSize(3);
    }

    @Test @Order(3) void appliesTypeSpecificKeywordAndDrillFilters() throws Exception {
        Cookie cookie = login("t20-user");
        JsonNode expense = summary(cookie, Map.of("scope", "EXPENSE", "range", "THIS_YEAR",
                "productId", PRODUCT.toString(), "query", "团队午餐"));
        assertThat(expense.path("grossExpense").asText()).isEqualTo("100.00");
        assertThat(expense.path("adjustmentAmount").asText()).isEqualTo("30.00");
        assertThat(expense.path("matchingItemCount").asLong()).isEqualTo(2);
        JsonNode income = summary(cookie, Map.of("scope", "INCOME", "range", "THIS_YEAR",
                "incomeCategoryId", INCOME_CATEGORY.toString(), "incomeName", "项目奖金"));
        assertThat(income.path("totalIncome").asText()).isEqualTo("250.00");
        assertThat(income.path("matchingItemCount").asLong()).isEqualTo(1);
        mockMvc.perform(get("/api/v1/ledger-entries").cookie(cookie).queryParam("type", "EXPENSE")
                .queryParam("range", "THIS_YEAR").queryParam("productId", PRODUCT.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(EXPENSE.toString()));
    }

    @Test @Order(4) void rejectsIncompatibleAndInvalidDateFilters() throws Exception {
        Cookie cookie = login("t20-user");
        mockMvc.perform(get("/api/v1/reports/summary").cookie(cookie).queryParam("scope", "ALL")
                .queryParam("productId", PRODUCT.toString())).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.scope[0]").exists());
        mockMvc.perform(get("/api/v1/reports/summary").cookie(cookie).queryParam("range", "CUSTOM")
                .queryParam("startDate", "2026-09-30").queryParam("endDate", "2026-09-01"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.startDate[0]").exists());
    }

    @Test @Order(5) void enforcesRoleAndTenantBoundaries() throws Exception {
        JsonNode result = summary(login("t20-user"), Map.of("range", "THIS_YEAR", "query", "其他租户机密"));
        assertThat(result.path("matchingItemCount").asLong()).isZero();
        mockMvc.perform(get("/api/v1/reports/summary")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/reports/summary").cookie(login("t20-admin"))).andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/reports/time")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/reports/time").cookie(login("t20-admin"))).andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/reports/expenses").queryParam("dimension", "PRODUCT"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/reports/expenses").cookie(login("t20-admin")).queryParam("dimension", "PRODUCT"))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/reports/incomes").queryParam("dimension", "PAYER"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/reports/incomes").cookie(login("t20-admin")).queryParam("dimension", "PAYER"))
                .andExpect(status().isForbidden());
    }

    @Test @Order(6) void returnsZeroFilledTimeBucketsCumulativeValuesAndComparisons() throws Exception {
        Cookie cookie = login("t20-user");
        JsonNode result = time(cookie, Map.of("range", "CUSTOM", "startDate", "2026-09-01", "endDate", "2026-09-15", "grain", "DAY"));
        assertThat(result.path("buckets")).hasSize(15);
        assertThat(result.path("buckets").get(0).path("balance").asText()).isEqualTo("0.00");
        assertThat(result.path("buckets").get(6).path("balance").asText()).isEqualTo("150.00");
        assertThat(result.path("buckets").get(6).path("incomeCount").asLong()).isEqualTo(1);
        assertThat(result.path("buckets").get(6).path("expenseCount").asLong()).isEqualTo(1);
        assertThat(result.path("buckets").get(7).path("balance").asText()).isEqualTo("30.00");
        assertThat(result.path("buckets").get(7).path("adjustmentCount").asLong()).isEqualTo(1);
        assertThat(result.path("buckets").get(14).path("cumulativeBalance").asText()).isEqualTo("180.00");
        JsonNode balance = result.path("comparisons").findValuesAsText("metric").indexOf("BALANCE") >= 0
                ? result.path("comparisons").get(4) : null;
        assertThat(balance).isNotNull();
        assertThat(balance.path("periodOverPeriod").path("amount").asText()).isEqualTo("30.00");
        assertThat(balance.path("periodOverPeriod").path("changePercent").asText()).isEqualTo("500.00");
        assertThat(balance.path("yearOverYear").path("amount").asText()).isEqualTo("130.00");
        assertThat(balance.path("yearOverYear").path("changePercent").asText()).isEqualTo("38.46");
        for (String grain : new String[]{"WEEK", "MONTH", "QUARTER", "YEAR"}) {
            assertThat(time(cookie, Map.of("range", "CUSTOM", "startDate", "2026-09-01", "endDate", "2026-09-15", "grain", grain)).path("buckets").isEmpty()).isFalse();
        }
        mockMvc.perform(get("/api/v1/ledger-entries").cookie(cookie).queryParam("type", "EXPENSE_FLOW")
                .queryParam("range", "CUSTOM").queryParam("startDate", "2026-09-01").queryParam("endDate", "2026-09-15"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2));
    }

    @Test @Order(7) void explainsUnavailableComparisonAndRejectsUnboundedGranularity() throws Exception {
        Cookie cookie = login("t20-user");
        JsonNode incomplete = time(cookie, Map.of("range", "CUSTOM", "startDate", "2026-09-01", "endDate", "2026-10-15", "grain", "WEEK"));
        assertThat(incomplete.path("comparisons").get(4).path("periodOverPeriod").path("startDate").asText()).isEqualTo("2026-08-05");
        assertThat(incomplete.path("comparisons").get(4).path("periodOverPeriod").path("endDate").asText()).isEqualTo("2026-08-31");
        assertThat(incomplete.path("comparisons").get(4).path("yearOverYear").path("endDate").asText()).isEqualTo("2025-09-27");
        tenantDatabase.execute(TENANT, () -> { jdbc.sql("UPDATE app_user SET created_at='2026-08-20T00:00:00Z' WHERE id=:id").param("id", USER).update(); return null; });
        JsonNode result = time(cookie, Map.of("range", "CUSTOM", "startDate", "2026-09-01", "endDate", "2026-09-15", "grain", "DAY"));
        assertThat(result.path("comparisons").get(4).path("periodOverPeriod").path("unavailableReason").asText())
                .contains("账号在对比区间开始后创建");
        tenantDatabase.execute(TENANT, () -> { jdbc.sql("UPDATE app_user SET created_at='2024-01-01T00:00:00Z' WHERE id=:id").param("id", USER).update(); return null; });
        mockMvc.perform(get("/api/v1/reports/time").cookie(cookie).queryParam("range", "CUSTOM")
                .queryParam("startDate", "2024-01-01").queryParam("endDate", "2026-09-15").queryParam("grain", "DAY"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.grain[0]").exists());
    }

    @Test @Order(8) void reportDateAccessCanUseExistingIndexes() {
        String plan = tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("SET LOCAL enable_seqscan=off").update();
            return String.join("\n", jdbc.sql("EXPLAIN SELECT paid_amount FROM ledger_entry WHERE tenant_id=current_setting('app.tenant_id')::uuid AND lifecycle_status='ACTIVE' AND business_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'").query(String.class).list());
        });
        assertThat(plan).containsAnyOf("idx_ledger_active_cursor", "idx_ledger_type_date");
    }

    @Test @Order(9) void returnsEveryExpenseDimensionAndVersionedQualityClues() throws Exception {
        Cookie cookie = login("t20-user");
        Map<String, String> range = Map.of("range", "CUSTOM", "startDate", "2026-07-01", "endDate", "2026-07-01");
        for (String dimension : new String[]{"CATEGORY", "PRODUCT", "FUNDING_CHANNEL", "PURCHASE_CHANNEL",
                "LOCATION", "HABIT", "PRICE", "FREQUENCY"}) {
            JsonNode report = expenses(cookie, dimension, range);
            assertThat(report.path("points").isEmpty()).as(dimension).isFalse();
            assertThat(report.path("points").get(0).path("value").asText()).as(dimension).isNotBlank();
        }
        JsonNode product = expenses(cookie, "PRODUCT", range);
        assertThat(product.path("points").get(0).path("detail").asText()).contains("数量 3").contains("平均填写单价");
        JsonNode location = expenses(cookie, "LOCATION", range);
        assertThat(location.path("points").get(0).path("value").asText()).isEqualTo("UNSPECIFIED");
        JsonNode habit = expenses(cookie, "HABIT", range);
        assertThat(habit.path("points").findValuesAsText("label"))
                .contains("日均", "月均", "单条均值", "周三", "上午");
        assertThat(habit.path("points").findValuesAsText("amount")).contains("210.00", "70.00");
        JsonNode emptyHabit = expenses(cookie, "HABIT",
                Map.of("range", "CUSTOM", "startDate", "2024-01-01", "endDate", "2024-01-01"));
        assertThat(emptyHabit.path("points").isEmpty()).isTrue();
        JsonNode frequency = expenses(cookie, "FREQUENCY", range);
        JsonNode longUnused = java.util.stream.StreamSupport.stream(frequency.path("points").spliterator(), false)
                .filter(point -> point.path("group").asText().equals("长期未购买")).findFirst().orElseThrow();
        assertThat(longUnused.path("label").asText()).isEqualTo("历史支出");
        assertThat(longUnused.path("drillStartDate").asText()).isEqualTo("2025-09-07");
        assertThat(longUnused.path("drillEndDate").asText()).isEqualTo("2025-09-07");
        assertThat(longUnused.path("entryId").asText()).isEqualTo("20300000-0000-4000-8000-000000000021");
        JsonNode quality = expenses(cookie, "QUALITY", range);
        assertThat(quality.path("qualityRule").path("version").asText()).isEqualTo("expense-quality-v1");
        assertThat(quality.path("qualityRule").path("priceWindowDays").asInt()).isEqualTo(180);
        assertThat(quality.path("qualityRule").path("minimumPriceSamples").asInt()).isEqualTo(3);
        assertThat(quality.path("qualityRule").path("highPriceMultiplier").asText()).isEqualTo("1.50");
        assertThat(quality.path("qualityRule").path("duplicateWindowMinutes").asInt()).isEqualTo(10);
        assertThat(quality.path("points")).hasSize(3);
        assertThat(quality.path("points").findValuesAsText("warning"))
                .contains("异常高价线索", "疑似重复线索");
        mockMvc.perform(get("/api/v1/ledger-entries").cookie(cookie).queryParam("type", "EXPENSE")
                .queryParam("range", "CUSTOM").queryParam("startDate", "2026-07-01").queryParam("endDate", "2026-07-01")
                .queryParam("entryId", DUPLICATE_ENTRY.toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(DUPLICATE_ENTRY.toString()));
    }

    @Test @Order(10) void returnsEveryIncomeDimensionWithSnapshotLabelsAndExactDrillValues() throws Exception {
        Cookie cookie = login("t20-user");
        Map<String, String> range = Map.of("range", "CUSTOM", "startDate", "2026-07-01", "endDate", "2026-07-31");
        for (String dimension : new String[]{"CATEGORY", "FUNDING_CHANNEL", "PAYER", "NAME", "FREQUENCY"}) {
            JsonNode report = incomes(cookie, dimension, range);
            assertThat(report.path("points").isEmpty()).as(dimension).isFalse();
            assertThat(report.path("points").get(0).path("value").asText()).as(dimension).isNotBlank();
        }
        JsonNode payer = incomes(cookie, "PAYER", range);
        JsonNode stoppedPayer = java.util.stream.StreamSupport.stream(payer.path("points").spliterator(), false)
                .filter(point -> point.path("value").asText().equals(STOPPED_PAYER.toString())).findFirst().orElseThrow();
        assertThat(stoppedPayer.path("label").asText()).isEqualTo("公司乙");
        assertThat(stoppedPayer.path("amount").asText()).isEqualTo("2200.00");
        assertThat(stoppedPayer.path("itemCount").asLong()).isEqualTo(2);
        assertThat(payer.path("points").findValuesAsText("value").stream()
                .filter(STOPPED_PAYER.toString()::equals)).hasSize(1);
        JsonNode frequency = incomes(cookie, "FREQUENCY", range);
        assertThat(frequency.path("measureLabel").asText()).isEqualTo("收入明细数");
        assertThat(frequency.path("points").get(0).path("label").asText()).isEqualTo("月度工资");
        assertThat(frequency.path("points").get(0).path("amount").asText()).isEqualTo("2.00");
        assertThat(frequency.path("points").get(0).path("detail").asText())
                .contains("累计收入 ¥2200.00").contains("最近记录 2026-07-02");
        mockMvc.perform(get("/api/v1/ledger-entries").cookie(cookie).queryParam("type", "INCOME")
                .queryParam("range", "CUSTOM").queryParam("startDate", "2026-07-01").queryParam("endDate", "2026-07-31")
                .queryParam("incomeName", "月度工资"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2));
    }

    private JsonNode summary(Cookie cookie, Map<String, String> params) throws Exception {
        var request = get("/api/v1/reports/summary").cookie(cookie);
        params.forEach(request::queryParam);
        return objectMapper.readTree(mockMvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    }

    private JsonNode time(Cookie cookie, Map<String, String> params) throws Exception {
        var request = get("/api/v1/reports/time").cookie(cookie);
        params.forEach(request::queryParam);
        return objectMapper.readTree(mockMvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    }

    private JsonNode expenses(Cookie cookie, String dimension, Map<String, String> params) throws Exception {
        var request = get("/api/v1/reports/expenses").cookie(cookie).queryParam("dimension", dimension);
        params.forEach(request::queryParam);
        return objectMapper.readTree(mockMvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    }

    private JsonNode incomes(Cookie cookie, String dimension, Map<String, String> params) throws Exception {
        var request = get("/api/v1/reports/incomes").cookie(cookie).queryParam("dimension", dimension);
        params.forEach(request::queryParam);
        return objectMapper.readTree(mockMvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
    }

    private Cookie login(String username) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsBytes(Map.of("username", username, "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("MY_BILL_SESSION");
    }

    private void user(UUID id, String username, String role, UUID tenant) {
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,:username,:password,:role,:tenant)")
                .param("id", id).param("username", username).param("password", passwordEncoder.encode(PASSWORD))
                .param("role", role).param("tenant", tenant).update();
    }

    private void dictionaries() {
        dictionary("expense_category", CATEGORY, "餐饮"); dictionary("unit", UNIT, "次");
        dictionary("funding_channel", FUNDING, "银行卡"); dictionary("payer", PAYER, "客户甲");
        dictionary("income_category", INCOME_CATEGORY, "奖金");
        dictionary("payer", STOPPED_PAYER, "公司乙");
        dictionary("income_category", STOPPED_INCOME_CATEGORY, "工资");
        dictionary("funding_channel", STOPPED_FUNDING, "支付宝");
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,'团队午餐','团队午餐','ACTIVE')").param("id", PRODUCT).update();
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,'历史支出','历史支出','ACTIVE')").param("id", HISTORY_PRODUCT).update();
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,'品质咖啡','品质咖啡','ACTIVE')").param("id", QUALITY_PRODUCT).update();
    }

    private void expense(UUID id, String name, String amount) {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot,note)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE','2026-09-07T12:00:00+08:00','2026-09-07',
                  :product,:name,:category,'餐饮',:unit,'次',:amount,1,:amount,:amount,:funding,'银行卡','项目聚餐')
                """).param("id", id).param("product", PRODUCT).param("name", name).param("category", CATEGORY)
                .param("unit", UNIT).param("amount", new BigDecimal(amount)).param("funding", FUNDING).update();
    }

    private void income() {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot,note)
                VALUES(current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000002','INCOME','2026-09-07T13:00:00+08:00','2026-09-07',
                  '项目奖金',:payer,'客户甲',:category,'奖金',250.00,:funding,'银行卡','到账')
                """).param("payer", PAYER).param("category", INCOME_CATEGORY).param("funding", FUNDING).update();
    }

    private void incomeDimensions() {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot,note)
                VALUES(current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000050','INCOME','2026-07-01T09:00:00+08:00','2026-07-01',
                    '月度工资',:payer,'公司乙旧称',:category,'工资旧分类',1000.00,:funding,'旧收款方式','六月工资'),
                  (current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000051','INCOME','2026-07-02T09:00:00+08:00','2026-07-02',
                    '月度工资',:payer,'公司乙',:category,'工资',1200.00,:funding,'支付宝','补发工资'),
                  (current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000052','INCOME','2026-07-03T09:00:00+08:00','2026-07-03',
                    '礼金',:activePayer,'客户甲',:activeCategory,'奖金',300.00,:activeFunding,'银行卡','节日礼金')
                """).param("payer", STOPPED_PAYER).param("category", STOPPED_INCOME_CATEGORY)
                .param("funding", STOPPED_FUNDING).param("activePayer", PAYER)
                .param("activeCategory", INCOME_CATEGORY).param("activeFunding", FUNDING).update();
        jdbc.sql("UPDATE payer SET status='INACTIVE' WHERE id=:id").param("id", STOPPED_PAYER).update();
        jdbc.sql("UPDATE income_category SET status='INACTIVE' WHERE id=:id").param("id", STOPPED_INCOME_CATEGORY).update();
        jdbc.sql("UPDATE funding_channel SET status='INACTIVE' WHERE id=:id").param("id", STOPPED_FUNDING).update();
    }

    private void adjustment() {
        jdbc.sql("""
                INSERT INTO expense_adjustment(tenant_id,id,original_expense_id,adjustment_type,amount,business_time,business_date,note)
                VALUES(current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000003',:expense,'REFUND',30.00,
                  '2026-09-08T12:00:00+08:00','2026-09-08','部分退款')
                """).param("expense", EXPENSE).update();
    }

    private void excludedAdjustments() {
        jdbc.sql("""
                INSERT INTO expense_adjustment(tenant_id,id,original_expense_id,adjustment_type,amount,business_time,business_date,status,note)
                VALUES(current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000005',:expense,'REFUND',5.00,
                  '2026-09-09T12:00:00+08:00','2026-09-09','REVOKED','已撤销'),
                  (current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000006',:expense,'REIMBURSEMENT',5.00,
                  '2026-09-10T12:00:00+08:00','2026-09-10','SOURCE_FROZEN','已冻结')
                """).param("expense", EXPENSE).update();
    }

    private void comparisonHistory() {
        comparisonEntries("20300000-0000-4000-8000-000000000010", "2026-08-20", "100.00", "80.00", "10.00");
        comparisonEntries("20300000-0000-4000-8000-000000000020", "2025-09-07", "200.00", "90.00", "20.00");
    }

    private void qualityHistory() {
        qualityExpense(uuid("20300000-0000-4000-8000-000000000040"), "2026-06-01T09:00:00+08:00", "10.00");
        qualityExpense(uuid("20300000-0000-4000-8000-000000000041"), "2026-06-05T09:00:00+08:00", "10.00");
        qualityExpense(uuid("20300000-0000-4000-8000-000000000042"), "2026-07-01T08:00:00+08:00", "10.00");
        qualityExpense(QUALITY_ENTRY, "2026-07-01T09:00:00+08:00", "100.00");
        qualityExpense(DUPLICATE_ENTRY, "2026-07-01T09:05:00+08:00", "100.00");
    }

    private void qualityExpense(UUID id, String time, String amount) {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE',CAST(:time AS timestamptz),
                  (CAST(:time AS timestamptz) AT TIME ZONE 'Asia/Shanghai')::date,:product,'品质咖啡',:category,'餐饮',
                  :unit,'次',:amount,1,:amount,:amount,:funding,'银行卡')
                """).param("id", id).param("time", time).param("product", QUALITY_PRODUCT).param("category", CATEGORY)
                .param("unit", UNIT).param("amount", new BigDecimal(amount)).param("funding", FUNDING).update();
    }

    private void comparisonEntries(String idPrefix, String date, String income, String expense, String adjustment) {
        UUID incomeId = UUID.fromString(idPrefix), expenseId = new UUID(incomeId.getMostSignificantBits(), incomeId.getLeastSignificantBits() + 1);
        UUID adjustmentId = new UUID(incomeId.getMostSignificantBits(), incomeId.getLeastSignificantBits() + 2);
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME',CAST(:date AS date)::timestamp AT TIME ZONE 'Asia/Shanghai',CAST(:date AS date),
                  '历史收入',:payer,'客户甲',:category,'奖金',:amount,:funding,'银行卡')
                """).param("id", incomeId).param("date", date).param("payer", PAYER).param("category", INCOME_CATEGORY)
                .param("amount", new BigDecimal(income)).param("funding", FUNDING).update();
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE',CAST(:date AS date)::timestamp AT TIME ZONE 'Asia/Shanghai',CAST(:date AS date),
                  :product,'历史支出',:category,'餐饮',:unit,'次',:amount,1,:amount,:amount,:funding,'银行卡')
                """).param("id", expenseId).param("date", date).param("product", HISTORY_PRODUCT).param("category", CATEGORY).param("unit", UNIT)
                .param("amount", new BigDecimal(expense)).param("funding", FUNDING).update();
        jdbc.sql("""
                INSERT INTO expense_adjustment(tenant_id,id,original_expense_id,adjustment_type,amount,business_time,business_date)
                VALUES(current_setting('app.tenant_id')::uuid,:id,:expense,'REFUND',:amount,
                  CAST(:date AS date)::timestamp AT TIME ZONE 'Asia/Shanghai',CAST(:date AS date))
                """).param("id", adjustmentId).param("expense", expenseId).param("amount", new BigDecimal(adjustment)).param("date", date).update();
    }

    private void trashedIncome() {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,lifecycle_status,deleted_at,purge_after,
                  income_name,payer_id,payer_name_snapshot,income_category_id,income_category_name_snapshot,income_amount,
                  funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000004','INCOME','2026-09-07T14:00:00+08:00','2026-09-07',
                  'TRASHED','2026-09-08T00:00:00Z','2026-10-08T00:00:00Z','已删除收入',:payer,'客户甲',:category,'奖金',999,:funding,'银行卡')
                """).param("payer", PAYER).param("category", INCOME_CATEGORY).param("funding", FUNDING).update();
    }

    private void foreignIncome() {
        UUID payer = uuid("20400000-0000-4000-8000-000000000015"), category = uuid("20400000-0000-4000-8000-000000000016"), funding = uuid("20400000-0000-4000-8000-000000000017");
        dictionary("payer", payer, "外部付款方"); dictionary("income_category", category, "外部收入"); dictionary("funding_channel", funding, "外部渠道");
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,'20300000-0000-4000-8000-000000000099','INCOME','2026-09-07T13:00:00+08:00','2026-09-07',
                  '其他租户机密',:payer,'外部付款方',:category,'外部收入',999,:funding,'外部渠道')
                """).param("payer", payer).param("category", category).param("funding", funding).update();
    }

    private void dictionary(String table, UUID id, String name) {
        jdbc.sql("INSERT INTO " + table + "(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", id).param("name", name).update();
    }

    private static UUID uuid(String value) { return UUID.fromString(value); }
}
