package com.mybill.dictionary;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
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

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** T8 在真实隔离 PostgreSQL 上验证八类个人字典维护、RLS、候选与历史引用。 */
@SpringBootTest(properties = {
        "my-bill.auth.bcrypt-strength=10",
        "my-bill.auth.rate-limit-pepper=test-dictionary-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false"
})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PersonalDictionaryHttpIntegrationTest {
    private static final UUID TENANT = UUID.fromString("c1000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_TENANT = UUID.fromString("c1000000-0000-0000-0000-000000000002");
    private static final UUID USER = UUID.fromString("c2000000-0000-0000-0000-000000000001");
    private static final UUID ADMIN = UUID.fromString("c2000000-0000-0000-0000-000000000002");
    private static final String PASSWORD = "T8-User-Formal-Password-2026";
    private static final Map<String, String> TABLES = Map.of(
            "product", "product", "expense-category", "expense_category", "unit", "unit",
            "funding-channel", "funding_channel", "purchase-channel", "purchase_channel",
            "location", "location_label", "income-category", "income_category", "payer", "payer");
    private static final Map<String, UUID> FIRST_IDS = new LinkedHashMap<>();
    private static final Map<String, UUID> SECOND_IDS = new LinkedHashMap<>();

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired TenantDatabaseExecutor tenantDatabase;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        String jdbcUrl = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> jdbcUrl);
        registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test");
        registry.add("spring.flyway.url", () -> jdbcUrl);
        registry.add("spring.flyway.user", () -> "my_bill_migration");
        registry.add("spring.flyway.password", () -> "migration_test");
    }

    @BeforeAll
    static void requireExternalDatabase() {
        assertThat(System.getProperty("mybill.test.jdbc-url")).isNotBlank();
    }

    @Test
    @Order(1)
    void prepareSyntheticPrincipals() {
        jdbc.sql("INSERT INTO tenant(id) VALUES (:id), (:other)")
                .param("id", TENANT).param("other", OTHER_TENANT).update();
        insertUser(USER, TENANT, "t8-user", PASSWORD, "USER");
        insertUser(ADMIN, null, "t8-admin", "T8-Admin-Formal-Password-2026", "ADMIN");
    }

    @Test
    @Order(2)
    void userCanMaintainEveryTypeWhileAdminIsForbidden() throws Exception {
        Cookie user = login("t8-user", PASSWORD);
        Cookie admin = login("t8-admin", "T8-Admin-Formal-Password-2026");
        mockMvc.perform(get("/api/v1/dictionaries").cookie(admin))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));

        for (String type : TABLES.keySet()) {
            UUID first = create(user, type, type + " 甲", null);
            UUID second = create(user, type, type + " 乙", null);
            FIRST_IDS.put(type, first);
            SECOND_IDS.put(type, second);

            mockMvc.perform(patch("/api/v1/dictionaries/{type}/{id}", type, first).with(csrf()).cookie(user)
                            .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", type + " 新名称"))))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(first.toString()))
                    .andExpect(jsonPath("$.name").value(type + " 新名称"));
            mockMvc.perform(post("/api/v1/dictionaries/{type}/{id}/move", type, second).with(csrf()).cookie(user)
                            .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("direction", "UP"))))
                    .andExpect(status().isOk());
            changeStatus(user, type, first, "INACTIVE", 200);
            mockMvc.perform(get("/api/v1/dictionaries/{type}/candidates", type).cookie(user))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.items[?(@.id == '%s')]".formatted(first)).isEmpty());
            changeStatus(user, type, first, "ACTIVE", 200);

            long stored = tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM " + TABLES.get(type))
                    .query(Long.class).single());
            assertThat(stored).isEqualTo(2);
        }

        mockMvc.perform(get("/api/v1/dictionaries").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(8));
        mockMvc.perform(get("/api/v1/dictionaries/unit").queryParam("query", "%").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));
    }

    @Test
    @Order(3)
    void normalizedDuplicatesAndTwoLevelCategoryRulesAreEnforced() throws Exception {
        Cookie user = login("t8-user", PASSWORD);
        create(user, "unit", "ＫＧ", null);
        mockMvc.perform(post("/api/v1/dictionaries/unit").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", "kg"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DICTIONARY_NAME_CONFLICT"))
                .andExpect(jsonPath("$.fieldErrors.name[0]").isNotEmpty());
        mockMvc.perform(post("/api/v1/dictionaries/unit").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", "\u00a0\u3000"))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        create(user, "product", "😀".repeat(150), null);
        mockMvc.perform(post("/api/v1/dictionaries/unit").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", "😀".repeat(101)))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        UUID root = FIRST_IDS.get("expense-category");
        UUID child = create(user, "expense-category", "二级分类", root);
        mockMvc.perform(post("/api/v1/dictionaries/expense-category").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "非法三级", "parentId", child))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        changeStatus(user, "expense-category", root, "INACTIVE", 409);
        changeStatus(user, "expense-category", child, "INACTIVE", 200);
        changeStatus(user, "expense-category", root, "INACTIVE", 200);
        changeStatus(user, "expense-category", child, "ACTIVE", 409);
        changeStatus(user, "expense-category", root, "ACTIVE", 200);
        changeStatus(user, "expense-category", child, "ACTIVE", 200);
    }

    @Test
    @Order(4)
    void guessedCrossTenantIdIsInvisible() throws Exception {
        Cookie user = login("t8-user", PASSWORD);
        UUID foreignId = UUID.fromString("c3000000-0000-0000-0000-000000000001");
        tenantDatabase.execute(OTHER_TENANT, () -> jdbc.sql("""
                INSERT INTO unit(id, tenant_id, display_name, normalized_name)
                VALUES (:id, current_setting('app.tenant_id')::uuid, '其他租户单位', '其他租户单位')
                """).param("id", foreignId).update());

        mockMvc.perform(patch("/api/v1/dictionaries/unit/{id}", foreignId).with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", "越权改名"))))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("DICTIONARY_ITEM_NOT_FOUND"));
        assertThat(tenantDatabase.execute(OTHER_TENANT, () -> jdbc.sql("SELECT display_name FROM unit WHERE id = :id")
                .param("id", foreignId).query(String.class).single())).isEqualTo("其他租户单位");
    }

    @Test
    @Order(5)
    void renamingReferencedItemPreservesHistoricalSnapshot() throws Exception {
        Cookie user = login("t8-user", PASSWORD);
        UUID funding = FIRST_IDS.get("funding-channel");
        UUID payer = FIRST_IDS.get("payer");
        UUID category = FIRST_IDS.get("income-category");
        UUID ledgerId = UUID.fromString("c4000000-0000-0000-0000-000000000001");
        Instant businessTime = Instant.parse("2026-09-05T16:00:00Z");
        tenantDatabase.execute(TENANT, () -> jdbc.sql("""
                INSERT INTO ledger_entry(tenant_id, id, entry_type, business_time, business_date,
                    income_name, payer_id, payer_name_snapshot, income_category_id, income_category_name_snapshot,
                    income_amount, funding_channel_id, funding_channel_name_snapshot)
                VALUES (current_setting('app.tenant_id')::uuid, :id, 'INCOME', :time, :date,
                    '工资', :payer, '付款方旧快照', :category, '收入分类旧快照', 100.00, :funding, '资金渠道旧快照')
                """).param("id", ledgerId).param("time", Timestamp.from(businessTime))
                .param("date", LocalDate.ofInstant(businessTime, ZoneId.of("Asia/Shanghai")))
                .param("payer", payer).param("category", category).param("funding", funding).update());

        mockMvc.perform(patch("/api/v1/dictionaries/funding-channel/{id}", funding).with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", "工资卡"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.referenced").value(true));
        mockMvc.perform(get("/api/v1/dictionaries/funding-channel").cookie(user))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == '%s')].referenced".formatted(funding)).value(true));
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql(
                        "SELECT funding_channel_name_snapshot FROM ledger_entry WHERE id = :id")
                .param("id", ledgerId).query(String.class).single())).isEqualTo("资金渠道旧快照");
    }

    @Test @Order(6)
    void historicalFiltersPageAllStatusesAndResolveOnlyOwnedIds() throws Exception {
        Cookie user = login("t8-user", PASSWORD);
        tenantDatabase.execute(TENANT, () -> jdbc.sql("""
                INSERT INTO funding_channel(tenant_id,id,display_name,normalized_name,sort_order,status)
                SELECT current_setting('app.tenant_id')::uuid,gen_random_uuid(),'分页渠道'||i,'分页渠道'||i,i,
                  CASE WHEN i=55 THEN 'INACTIVE' ELSE 'ACTIVE' END FROM generate_series(1,55) i
                """).update());
        mockMvc.perform(get("/api/v1/dictionaries/funding-channel").cookie(user)
                        .param("query", "分页渠道").param("page", "2").param("size", "20"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(55))
                .andExpect(jsonPath("$.items.length()").value(15))
                .andExpect(jsonPath("$.items[14].status").value("INACTIVE"));
        UUID stopped = tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT id FROM funding_channel WHERE display_name='分页渠道55'").query(UUID.class).single());
        mockMvc.perform(get("/api/v1/dictionaries/funding-channel/{id}", stopped).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INACTIVE"));
        mockMvc.perform(get("/api/v1/dictionaries/unit/c3000000-0000-0000-0000-000000000001").cookie(user))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/dictionaries/funding-channel/{id}", stopped)).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/dictionaries/funding-channel/{id}", stopped)
                        .cookie(login("t8-admin", "T8-Admin-Formal-Password-2026"))).andExpect(status().isForbidden());
        UUID root = FIRST_IDS.get("expense-category");
        mockMvc.perform(get("/api/v1/dictionaries/expense-category").cookie(user).param("parentId", root.toString()).param("size", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].parentId").value(root.toString()));
        mockMvc.perform(get("/api/v1/dictionaries/expense-category").cookie(user).param("rootsOnly", "true"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[?(@.parentId)]").isEmpty());
        mockMvc.perform(get("/api/v1/dictionaries/unit").cookie(user).param("rootsOnly", "true")).andExpect(status().isBadRequest());
    }

    private UUID create(Cookie user, String type, String name, UUID parentId) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        if (parentId != null) body.put("parentId", parentId);
        MvcResult result = mockMvc.perform(post("/api/v1/dictionaries/{type}", type).with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andExpect(status().isOk()).andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsByteArray()).path("id").asText());
    }

    private void changeStatus(Cookie user, String type, UUID id, String value, int expectedStatus) throws Exception {
        mockMvc.perform(post("/api/v1/dictionaries/{type}/{id}/status", type, id).with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("status", value))))
                .andExpect(status().is(expectedStatus));
    }

    private Cookie login(String username, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", password))))
                .andExpect(status().isOk()).andReturn();
        Cookie cookie = result.getResponse().getCookie("MY_BILL_SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }

    private void insertUser(UUID id, UUID tenantId, String username, String password, String role) {
        jdbc.sql("""
                        INSERT INTO app_user(id, username, password_digest, role, tenant_id)
                        VALUES (:id, :username, :digest, :role, :tenantId)
                        """).param("id", id).param("username", username).param("digest", passwordEncoder.encode(password))
                .param("role", role).param("tenantId", tenantId).update();
    }

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }
}
