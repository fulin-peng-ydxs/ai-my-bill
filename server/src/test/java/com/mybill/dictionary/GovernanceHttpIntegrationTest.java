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

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** T9 真实验证商品原子合并、模板收敛、默认字典权限及新用户快照边界。 */
@SpringBootTest(properties = {
        "my-bill.auth.bcrypt-strength=10",
        "my-bill.auth.rate-limit-pepper=test-governance-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false"
})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class GovernanceHttpIntegrationTest {
    private static final UUID TENANT = UUID.fromString("d1000000-0000-0000-0000-000000000001");
    private static final UUID USER = UUID.fromString("d2000000-0000-0000-0000-000000000001");
    private static final UUID ADMIN = UUID.fromString("d2000000-0000-0000-0000-000000000002");
    private static final UUID SOURCE = UUID.fromString("d3000000-0000-0000-0000-000000000001");
    private static final UUID TARGET = UUID.fromString("d3000000-0000-0000-0000-000000000002");
    private static final UUID EARLIER_SOURCE = UUID.fromString("d3000000-0000-0000-0000-000000000003");
    private static final String USER_PASSWORD = "T9-User-Formal-Password-2026";
    private static final String ADMIN_PASSWORD = "T9-Admin-Formal-Password-2026";

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
    void prepareUsersAndProductReferences() {
        jdbc.sql("INSERT INTO tenant(id) VALUES (:id)").param("id", TENANT).update();
        insertUser(USER, TENANT, "t9-user", USER_PASSWORD, "USER");
        insertUser(ADMIN, null, "t9-admin", ADMIN_PASSWORD, "ADMIN");
        tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("INSERT INTO expense_category(tenant_id,id,display_name,normalized_name) VALUES "
                    + "(:tenant,'d4000000-0000-0000-0000-000000000001','饮品','饮品')")
                    .param("tenant", TENANT).update();
            jdbc.sql("INSERT INTO unit(tenant_id,id,display_name,normalized_name) VALUES "
                    + "(:tenant,'d5000000-0000-0000-0000-000000000001','杯','杯')")
                    .param("tenant", TENANT).update();
            jdbc.sql("INSERT INTO funding_channel(tenant_id,id,display_name,normalized_name) VALUES "
                    + "(:tenant,'d6000000-0000-0000-0000-000000000001','现金','现金')")
                    .param("tenant", TENANT).update();
            jdbc.sql("""
                            INSERT INTO product(tenant_id,id,display_name,normalized_name,status,merged_into_id,sort_order)
                            VALUES (:tenant,:source,'咖啡豆','咖啡豆','ACTIVE',NULL,0),
                                   (:tenant,:target,'咖啡','咖啡','ACTIVE',NULL,10),
                                   (:tenant,:earlier,'旧咖啡豆','旧咖啡豆','MERGED',:source,20)
                            """).param("tenant", TENANT).param("source", SOURCE).param("target", TARGET)
                    .param("earlier", EARLIER_SOURCE).update();
            insertExpense("d7000000-0000-0000-0000-000000000001", SOURCE, "咖啡豆", "10.00");
            insertExpense("d7000000-0000-0000-0000-000000000002", TARGET, "咖啡", "12.00");
            insertTemplate("d8000000-0000-0000-0000-000000000001", SOURCE, "咖啡豆", "咖啡豆",
                    "d7000000-0000-0000-0000-000000000001", "10.00", "2026-09-06T10:00:00Z");
            insertTemplate("d8000000-0000-0000-0000-000000000002", TARGET, "咖啡", "咖啡",
                    "d7000000-0000-0000-0000-000000000002", "12.00", "2026-09-05T10:00:00Z");
            return null;
        });
    }

    @Test
    @Order(2)
    void concurrentEquivalentProductNamesCreateExactlyOneItem() throws Exception {
        Cookie user = login("t9-user", USER_PASSWORD);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var fullWidth = executor.submit(() -> createProductStatus(user, "Ｔ９并发商品"));
            var normalized = executor.submit(() -> createProductStatus(user, "t9并发商品"));
            assertThat(java.util.List.of(fullWidth.get(), normalized.get()))
                    .containsExactlyInAnyOrder(200, 409);
        }
        tenantDatabase.execute(TENANT, () -> {
            assertThat(jdbc.sql("SELECT count(*) FROM product WHERE normalized_name='t9并发商品'")
                    .query(Long.class).single()).isOne();
            return null;
        });
    }

    @Test
    @Order(3)
    void mergePreviewAndConfirmationPreserveHistoryAndConsolidateLatestTemplate() throws Exception {
        Cookie user = login("t9-user", USER_PASSWORD);
        mockMvc.perform(get("/api/v1/dictionaries/product/{source}/merge-preview", SOURCE)
                        .queryParam("targetProductId", TARGET.toString()).cookie(user))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source.name").value("咖啡豆"))
                .andExpect(jsonPath("$.target.name").value("咖啡"))
                .andExpect(jsonPath("$.affectedLedgerEntries").value(1))
                .andExpect(jsonPath("$.affectedTemplates").value(1))
                .andExpect(jsonPath("$.templateConflict").value(true));

        mockMvc.perform(post("/api/v1/dictionaries/product/{source}/merge", SOURCE).with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("targetProductId", TARGET))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mergeEventId").isString())
                .andExpect(jsonPath("$.impact.affectedLedgerEntries").value(1));

        tenantDatabase.execute(TENANT, () -> {
            assertThat(jdbc.sql("SELECT product_id::text || ':' || product_name_snapshot FROM ledger_entry "
                            + "WHERE id='d7000000-0000-0000-0000-000000000001'")
                    .query(String.class).single()).isEqualTo(TARGET + ":咖啡豆");
            assertThat(jdbc.sql("SELECT count(*) FROM daily_entry_template WHERE product_id=:target")
                    .param("target", TARGET).query(Long.class).single()).isOne();
            assertThat(jdbc.sql("SELECT display_name || ':' || paid_amount::text FROM daily_entry_template WHERE product_id=:target")
                    .param("target", TARGET).query(String.class).single()).isEqualTo("咖啡:10.00");
            assertThat(jdbc.sql("SELECT status || ':' || merged_into_id::text FROM product WHERE id=:source")
                    .param("source", SOURCE).query(String.class).single()).isEqualTo("MERGED:" + TARGET);
            assertThat(jdbc.sql("SELECT merged_into_id FROM product WHERE id=:source")
                    .param("source", EARLIER_SOURCE).query(UUID.class).single()).isEqualTo(TARGET);
            assertThat(jdbc.sql("SELECT count(*) FROM product_merge_event WHERE source_product_id=:source "
                            + "AND target_product_id=:target AND initiated_by_user_id=:user")
                    .param("source", SOURCE).param("target", TARGET).param("user", USER)
                    .query(Long.class).single()).isOne();
            return null;
        });

        mockMvc.perform(post("/api/v1/dictionaries/product/{source}/merge", SOURCE).with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("targetProductId", TARGET))))
                .andExpect(status().isConflict());
    }

    @Test
    @Order(4)
    void productRenameMigratesTemplateBusinessKeyButKeepsLedgerSnapshot() throws Exception {
        Cookie user = login("t9-user", USER_PASSWORD);
        mockMvc.perform(patch("/api/v1/dictionaries/product/{id}", TARGET).with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", "手冲咖啡"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("手冲咖啡"));
        tenantDatabase.execute(TENANT, () -> {
            assertThat(jdbc.sql("SELECT display_name || ':' || normalized_name || ':' || product_name_snapshot "
                            + "FROM daily_entry_template WHERE product_id=:target")
                    .param("target", TARGET).query(String.class).single()).isEqualTo("手冲咖啡:手冲咖啡:手冲咖啡");
            assertThat(jdbc.sql("SELECT product_name_snapshot FROM ledger_entry WHERE id="
                            + "'d7000000-0000-0000-0000-000000000001'")
                    .query(String.class).single()).isEqualTo("咖啡豆");
            return null;
        });
    }

    @Test
    @Order(5)
    void defaultDictionaryIsAdminOnlyAndChangesOnlyFutureUserCopies() throws Exception {
        Cookie ordinary = login("t9-user", USER_PASSWORD);
        mockMvc.perform(get("/api/v1/admin/default-dictionaries").cookie(ordinary))
                .andExpect(status().isForbidden());

        Cookie admin = login("t9-admin", ADMIN_PASSWORD);
        mockMvc.perform(get("/api/v1/admin/default-dictionaries").cookie(admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(5));
        createUser(admin, "t9-before-default");

        JsonNode created = objectMapper.readTree(mockMvc.perform(post("/api/v1/admin/default-dictionaries/unit")
                        .with(csrf()).cookie(admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Ｔ９箱"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACTIVE"))
                .andReturn().getResponse().getContentAsByteArray());
        String itemId = created.path("id").asText();
        mockMvc.perform(post("/api/v1/admin/default-dictionaries/unit").with(csrf()).cookie(admin)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", "T9箱"))))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DEFAULT_DICTIONARY_NAME_CONFLICT"));
        mockMvc.perform(get("/api/v1/admin/default-dictionaries/unit").queryParam("query", "%").cookie(admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));

        createUser(admin, "t9-with-default");
        assertTenantUnitCount("t9-before-default", "Ｔ９箱", 0);
        assertTenantUnitCount("t9-with-default", "Ｔ９箱", 1);

        mockMvc.perform(post("/api/v1/admin/default-dictionaries/unit/{id}/status", itemId)
                        .with(csrf()).cookie(admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("status", "INACTIVE"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INACTIVE"));
        createUser(admin, "t9-after-disabled");
        assertTenantUnitCount("t9-with-default", "Ｔ９箱", 1);
        assertTenantUnitCount("t9-after-disabled", "Ｔ９箱", 0);

        mockMvc.perform(post("/api/v1/admin/default-dictionaries/unit/{id}/move", itemId)
                        .with(csrf()).cookie(admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("direction", "UP"))))
                .andExpect(status().isOk());
        assertThat(jdbc.sql("SELECT string_agg(action, ',') FROM admin_audit_log WHERE object_id=:id")
                .param("id", itemId).query(String.class).single())
                .contains("CREATE_DEFAULT_DICTIONARY", "CHANGE_DEFAULT_DICTIONARY_STATUS");
    }

    @Test
    @Order(6)
    void defaultCategoryEnforcesTwoLevelsAndParentStatusOrder() throws Exception {
        Cookie admin = login("t9-admin", ADMIN_PASSWORD);
        String root = createDefault(admin, "expense-category", "T9一级", null);
        String child = createDefault(admin, "expense-category", "T9二级", root);
        mockMvc.perform(post("/api/v1/admin/default-dictionaries/expense-category")
                        .with(csrf()).cookie(admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "T9三级", "parentId", child))))
                .andExpect(status().isBadRequest());
        changeDefaultStatus(admin, root, "INACTIVE", 409);
        changeDefaultStatus(admin, child, "INACTIVE", 200);
        changeDefaultStatus(admin, root, "INACTIVE", 200);
        changeDefaultStatus(admin, child, "ACTIVE", 409);
        changeDefaultStatus(admin, root, "ACTIVE", 200);
        changeDefaultStatus(admin, child, "ACTIVE", 200);
    }

    private void insertExpense(String id, UUID productId, String snapshot, String amount) {
        jdbc.sql("""
                        INSERT INTO ledger_entry(
                            tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,
                            primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,
                            unit_price,quantity,calculated_amount,paid_amount,funding_channel_id,funding_channel_name_snapshot)
                        VALUES (:tenant,CAST(:id AS uuid),'EXPENSE','2026-09-06T10:00:00+08:00','2026-09-06',
                                :product,:snapshot,'d4000000-0000-0000-0000-000000000001','饮品',
                                'd5000000-0000-0000-0000-000000000001','杯',CAST(:amount AS numeric),1,
                                CAST(:amount AS numeric),CAST(:amount AS numeric),
                                'd6000000-0000-0000-0000-000000000001','现金')
                        """).param("tenant", TENANT).param("id", id).param("product", productId)
                .param("snapshot", snapshot).param("amount", amount).update();
    }

    private int createProductStatus(Cookie user, String name) throws Exception {
        return mockMvc.perform(post("/api/v1/dictionaries/product").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("name", name))))
                .andReturn().getResponse().getStatus();
    }

    private void insertTemplate(String id, UUID productId, String displayName, String normalizedName,
                                String sourceRecordId, String amount, String lastUsedAt) {
        jdbc.sql("""
                        INSERT INTO daily_entry_template(
                            tenant_id,id,entry_type,display_name,normalized_name,source_record_id,
                            product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,
                            unit_id,unit_name_snapshot,unit_price,quantity,paid_amount,
                            funding_channel_id,funding_channel_name_snapshot,last_used_at)
                        VALUES (:tenant,CAST(:id AS uuid),'EXPENSE',:display,:normalized,CAST(:sourceRecord AS uuid),
                                :product,:display,'d4000000-0000-0000-0000-000000000001','饮品',
                                'd5000000-0000-0000-0000-000000000001','杯',CAST(:amount AS numeric),1,
                                CAST(:amount AS numeric),
                                'd6000000-0000-0000-0000-000000000001','现金',CAST(:lastUsedAt AS timestamptz))
                        """).param("tenant", TENANT).param("id", id).param("display", displayName)
                .param("normalized", normalizedName).param("sourceRecord", sourceRecordId)
                .param("product", productId).param("amount", amount).param("lastUsedAt", lastUsedAt).update();
    }

    private String createDefault(Cookie admin, String type, String name, String parentId) throws Exception {
        Map<String, Object> body = parentId == null ? Map.of("name", name) : Map.of("name", name, "parentId", parentId);
        MvcResult result = mockMvc.perform(post("/api/v1/admin/default-dictionaries/{type}", type)
                        .with(csrf()).cookie(admin).contentType(MediaType.APPLICATION_JSON).content(json(body)))
                .andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsByteArray()).path("id").asText();
    }

    private void changeDefaultStatus(Cookie admin, String id, String statusValue, int expectedStatus) throws Exception {
        mockMvc.perform(post("/api/v1/admin/default-dictionaries/expense-category/{id}/status", id)
                        .with(csrf()).cookie(admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("status", statusValue))))
                .andExpect(status().is(expectedStatus));
    }

    private void createUser(Cookie admin, String username) throws Exception {
        mockMvc.perform(post("/api/v1/admin/users").with(csrf()).cookie(admin)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("username", username))))
                .andExpect(status().isOk());
    }

    private void assertTenantUnitCount(String username, String displayName, long expected) {
        UUID tenantId = jdbc.sql("SELECT tenant_id FROM app_user WHERE username=:username")
                .param("username", username).query(UUID.class).single();
        assertThat(tenantDatabase.execute(tenantId, () -> jdbc.sql("SELECT count(*) FROM unit WHERE display_name=:name")
                .param("name", displayName).query(Long.class).single())).isEqualTo(expected);
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
