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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t13-template-rate-limit-pepper", "my-bill.schema.validation-enabled=false"})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class DailyTemplateHttpIntegrationTest {
    private static final UUID TENANT = uuid("a1000000-0000-4000-8000-000000000001");
    private static final UUID OTHER = uuid("a1000000-0000-4000-8000-000000000002");
    private static final UUID USER = uuid("a2000000-0000-4000-8000-000000000001");
    private static final UUID PRODUCT = uuid("a3000000-0000-4000-8000-000000000001");
    private static final UUID CATEGORY = uuid("a4000000-0000-4000-8000-000000000001");
    private static final UUID UNIT = uuid("a5000000-0000-4000-8000-000000000001");
    private static final UUID FUNDING = uuid("a6000000-0000-4000-8000-000000000001");
    private static final UUID PAYER = uuid("a7000000-0000-4000-8000-000000000001");
    private static final UUID INCOME_CATEGORY = uuid("a8000000-0000-4000-8000-000000000001");
    private static final UUID EXPENSE = uuid("a9000000-0000-4000-8000-000000000001");
    private static final UUID INCOME_ONE = uuid("a9000000-0000-4000-8000-000000000002");
    private static final UUID INCOME_TWO = uuid("a9000000-0000-4000-8000-000000000003");
    private static final UUID INCOME_THREE = uuid("a9000000-0000-4000-8000-000000000005");
    private static final UUID FOREIGN_INCOME = uuid("a9000000-0000-4000-8000-000000000004");
    private static final String PASSWORD = "T13-Formal-Password-2026";
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
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,'t13-user',:password,'USER',:tenant)")
                .param("id", USER).param("password", passwordEncoder.encode(PASSWORD)).param("tenant", TENANT).update();
        tenantDatabase.execute(TENANT, () -> { prepareTenantData(); return null; });
        tenantDatabase.execute(OTHER, () -> { prepareForeignIncome(); return null; });
    }

    @Test @Order(2) void createsBothTypesAndUpdatesNormalizedIncomeKey() throws Exception {
        Cookie user = login();
        String expenseTemplate = upsert(user, EXPENSE).path("id").asText();
        String incomeTemplate = upsert(user, INCOME_ONE).path("id").asText();
        assertThat(upsert(user, EXPENSE).path("id").asText()).isEqualTo(expenseTemplate);
        assertThat(upsert(user, INCOME_TWO).path("id").asText()).isEqualTo(incomeTemplate);
        upsert(user, INCOME_THREE);
        mockMvc.perform(get("/api/v1/daily-templates").queryParam("type", "EXPENSE").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(expenseTemplate));
        mockMvc.perform(get("/api/v1/daily-templates").queryParam("type", "INCOME").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2));
        mockMvc.perform(post("/api/v1/daily-templates/{id}/select", expenseTemplate).with(csrf()).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.productName").value("咖啡"))
                .andExpect(jsonPath("$.unitPrice").value("12.5")).andExpect(jsonPath("$.paidAmount").value("25.00"))
                .andExpect(jsonPath("$.unavailableFields.length()").value(0));
        mockMvc.perform(post("/api/v1/daily-templates/{id}/select", incomeTemplate).with(csrf()).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.incomeName").value("bonus"))
                .andExpect(jsonPath("$.incomeAmount").value("88.00"));
        mockMvc.perform(get("/api/v1/daily-templates").queryParam("type", "INCOME").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value(incomeTemplate));
    }

    @Test @Order(3) void selectionFallsBackOnlyInactiveReferenceAndInvalidSourceIsRejected() throws Exception {
        Cookie user = login(); String templateId = templateId("INCOME", "bonus");
        tenantDatabase.execute(TENANT, () -> { jdbc.sql("UPDATE payer SET status='INACTIVE' WHERE id=:id").param("id", PAYER).update(); return null; });
        mockMvc.perform(post("/api/v1/daily-templates/{id}/select", templateId).with(csrf()).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.payerId").doesNotExist())
                .andExpect(jsonPath("$.incomeCategoryId").value(INCOME_CATEGORY.toString()))
                .andExpect(jsonPath("$.unavailableFields[0]").value("payerId"));
        mockMvc.perform(put("/api/v1/ledger-entries/{id}/daily-template", INCOME_ONE).with(csrf()).cookie(user))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DAILY_TEMPLATE_SOURCE_INVALID"));
        tenantDatabase.execute(TENANT, () -> { jdbc.sql("UPDATE payer SET status='ACTIVE' WHERE id=:id").param("id", PAYER).update(); return null; });
    }

    @Test @Order(4) void sourceDeletionDoesNotDeleteTemplateAndCrossTenantIsHidden() throws Exception {
        Cookie user = login(); String templateId = templateId("INCOME", "bonus");
        tenantDatabase.execute(TENANT, () -> { jdbc.sql("DELETE FROM ledger_entry WHERE id=:id").param("id", INCOME_TWO).update(); return null; });
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT source_record_id FROM daily_entry_template WHERE id=:id")
                .param("id", uuid(templateId)).query(UUID.class).optional())).isEmpty();
        mockMvc.perform(post("/api/v1/daily-templates/{id}/select", templateId).with(csrf()).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.incomeAmount").value("88.00"));
        mockMvc.perform(put("/api/v1/ledger-entries/{id}/daily-template", FOREIGN_INCOME).with(csrf()).cookie(user))
                .andExpect(status().isNotFound());
    }

    @Test @Order(5) void removeKeepsSourceLedgerAndSecondRemoveIsNotFound() throws Exception {
        Cookie user = login(); String templateId = templateId("EXPENSE", "咖啡");
        mockMvc.perform(delete("/api/v1/daily-templates/{id}", templateId).with(csrf()).cookie(user)).andExpect(status().isNoContent());
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM ledger_entry WHERE id=:id")
                .param("id", EXPENSE).query(Long.class).single())).isOne();
        mockMvc.perform(delete("/api/v1/daily-templates/{id}", templateId).with(csrf()).cookie(user)).andExpect(status().isNotFound());
    }

    private JsonNode upsert(Cookie user, UUID ledgerId) throws Exception {
        MvcResult result = mockMvc.perform(put("/api/v1/ledger-entries/{id}/daily-template", ledgerId).with(csrf()).cookie(user))
                .andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private String templateId(String type, String normalizedName) {
        return tenantDatabase.execute(TENANT, () -> jdbc.sql("""
                SELECT id::text FROM daily_entry_template WHERE entry_type=:type AND normalized_name=:name
                """).param("type", type).param("name", normalizedName).query(String.class).single());
    }

    private void prepareTenantData() {
        dictionary("expense_category", CATEGORY, "餐饮"); dictionary("unit", UNIT, "杯");
        dictionary("funding_channel", FUNDING, "银行卡"); dictionary("payer", PAYER, "客户甲");
        dictionary("income_category", INCOME_CATEGORY, "奖金");
        jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,'咖啡','咖啡','ACTIVE')")
                .param("id", PRODUCT).update();
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                  primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,
                  calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'EXPENSE','2026-09-07T08:00:00+08:00','2026-09-07',
                  :product,'旧咖啡名',:category,'餐饮',:unit,'杯',12.5,2,25,25,:funding,'银行卡')
                """).param("id", EXPENSE).param("product", PRODUCT).param("category", CATEGORY)
                .param("unit", UNIT).param("funding", FUNDING).update();
        income(INCOME_ONE, "BONUS", "66.00"); income(INCOME_TWO, "bonus", "88.00");
        income(INCOME_THREE, "兼职", "120.00");
    }

    private void prepareForeignIncome() {
        UUID payer = uuid("a7000000-0000-4000-8000-000000000002"); UUID category = uuid("a8000000-0000-4000-8000-000000000002");
        UUID funding = uuid("a6000000-0000-4000-8000-000000000002");
        dictionary("payer", payer, "其他付款方"); dictionary("income_category", category, "其他收入");
        dictionary("funding_channel", funding, "现金");
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-07T08:00:00+08:00','2026-09-07',
                  '外部收入',:payer,'其他付款方',:category,'其他收入',1,:funding,'现金')
                """).param("id", FOREIGN_INCOME).param("payer", payer).param("category", category).param("funding", funding).update();
    }

    private void income(UUID id, String name, String amount) {
        jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,funding_channel_name_snapshot)
                VALUES(current_setting('app.tenant_id')::uuid,:id,'INCOME','2026-09-07T08:00:00+08:00','2026-09-07',
                  :name,:payer,'客户甲',:category,'奖金',CAST(:amount AS numeric),:funding,'银行卡')
                """).param("id", id).param("name", name).param("payer", PAYER).param("category", INCOME_CATEGORY)
                .param("amount", amount).param("funding", FUNDING).update();
    }

    private void dictionary(String table, UUID id, String name) {
        jdbc.sql("INSERT INTO " + table + "(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", id).param("name", name).update();
    }

    private Cookie login() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("username", "t13-user", "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn();
        return result.getResponse().getCookie("MY_BILL_SESSION");
    }

    private static UUID uuid(String value) { return UUID.fromString(value); }
}
