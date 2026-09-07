package com.mybill.ledger;

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
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.boot.test.context.TestConfiguration;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "my-bill.auth.bcrypt-strength=10",
        "my-bill.auth.rate-limit-pepper=test-expense-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false"
})
@AutoConfigureMockMvc
@Import(ExpenseHttpIntegrationTest.FixedClockConfiguration.class)
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ExpenseHttpIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-09-06T12:00:00Z");
    private static final UUID TENANT = UUID.fromString("e1000000-0000-4000-8000-000000000001");
    private static final UUID OTHER_TENANT = UUID.fromString("e1000000-0000-4000-8000-000000000002");
    private static final UUID USER = UUID.fromString("e2000000-0000-4000-8000-000000000001");
    private static final UUID ADMIN = UUID.fromString("e2000000-0000-4000-8000-000000000002");
    private static final UUID PRODUCT = UUID.fromString("e3000000-0000-4000-8000-000000000001");
    private static final UUID OTHER_PRODUCT = UUID.fromString("e3000000-0000-4000-8000-000000000002");
    private static final UUID NORMALIZED_PRODUCT = UUID.fromString("e3000000-0000-4000-8000-000000000003");
    private static final UUID PRIMARY = UUID.fromString("e4000000-0000-4000-8000-000000000001");
    private static final UUID SECONDARY = UUID.fromString("e4000000-0000-4000-8000-000000000002");
    private static final UUID UNIT = UUID.fromString("e5000000-0000-4000-8000-000000000001");
    private static final UUID FUNDING = UUID.fromString("e6000000-0000-4000-8000-000000000001");
    private static final UUID PURCHASE = UUID.fromString("e7000000-0000-4000-8000-000000000001");
    private static final UUID LOCATION = UUID.fromString("e8000000-0000-4000-8000-000000000001");
    private static final String PASSWORD = "T11-User-Formal-Password-2026";

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

    @Test @Order(1)
    void preparePrincipalsAndDictionaries() {
        jdbc.sql("INSERT INTO tenant(id) VALUES (:tenant), (:other)")
                .param("tenant", TENANT).param("other", OTHER_TENANT).update();
        insertUser(USER, TENANT, "t11-user", PASSWORD, "USER");
        insertUser(ADMIN, null, "t11-admin", "T11-Admin-Formal-Password-2026", "ADMIN");
        tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("INSERT INTO expense_category(tenant_id,id,display_name,normalized_name,status) "
                            + "VALUES (current_setting('app.tenant_id')::uuid,:id,'餐饮','餐饮','ACTIVE')")
                    .param("id", PRIMARY).update();
            jdbc.sql("INSERT INTO expense_category(tenant_id,id,display_name,normalized_name,parent_id,status) "
                            + "VALUES (current_setting('app.tenant_id')::uuid,:id,'早餐','早餐',:parent,'ACTIVE')")
                    .param("id", SECONDARY).param("parent", PRIMARY).update();
            insertDictionary("unit", UNIT, "个");
            insertDictionary("funding_channel", FUNDING, "微信");
            insertDictionary("purchase_channel", PURCHASE, "商超");
            insertDictionary("location_label", LOCATION, "公司楼下");
            jdbc.sql("""
                    INSERT INTO product(tenant_id,id,display_name,normalized_name,status,
                        default_primary_category_id,default_secondary_category_id,default_unit_id,
                        last_unit_price,last_funding_channel_id,last_purchase_channel_id)
                    VALUES (current_setting('app.tenant_id')::uuid,:id,'早餐包','早餐包','ACTIVE',
                        :primary,:secondary,:unit,14.25,:funding,:purchase)
                    """).param("id", PRODUCT).param("primary", PRIMARY).param("secondary", SECONDARY)
                    .param("unit", UNIT).param("funding", FUNDING).param("purchase", PURCHASE).update();
            jdbc.sql("""
                    INSERT INTO product(tenant_id,id,display_name,normalized_name,status)
                    VALUES (current_setting('app.tenant_id')::uuid,:id,'Coffee Latte','coffee latte','ACTIVE')
                    """).param("id", NORMALIZED_PRODUCT).update();
            return null;
        });
        tenantDatabase.execute(OTHER_TENANT, () -> {
            jdbc.sql("INSERT INTO product(tenant_id,id,display_name,normalized_name,status) "
                            + "VALUES (current_setting('app.tenant_id')::uuid,:id,'其他租户商品','其他租户商品','ACTIVE')")
                    .param("id", OTHER_PRODUCT).update();
            return null;
        });
    }

    @Test @Order(2)
    void productSuggestionsReturnOnlyCurrentTenantAndValidDefaults() throws Exception {
        Cookie user = login("t11-user", PASSWORD);
        mockMvc.perform(get("/api/v1/expenses/products").queryParam("query", "早餐").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(PRODUCT.toString()))
                .andExpect(jsonPath("$.items[0].lastUnitPrice").value("14.25"))
                .andExpect(jsonPath("$.items[0].fundingChannelName").value("微信"));
        mockMvc.perform(get("/api/v1/expenses/products").queryParam("query", "其他租户").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());
        mockMvc.perform(get("/api/v1/expenses/products").queryParam("query", "ＣＯＦＦＥＥ   LATTE").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(NORMALIZED_PRODUCT.toString()));
    }

    @Test @Order(3)
    void createIsPreciseIdempotentAndUpdatesRecentProductValues() throws Exception {
        Cookie user = login("t11-user", PASSWORD);
        Map<String, Object> body = request(PRODUCT, NOW.plusSeconds(4 * 60 + 59), "3.335", "3", "9.50");
        MvcResult created = mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "expense-fixed-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.calculatedAmount").value("10.01"))
                .andExpect(jsonPath("$.paidAmount").value("9.50"))
                .andExpect(jsonPath("$.businessDate").value("2026-09-06"))
                .andExpect(jsonPath("$.productName").value("早餐包"))
                .andReturn();
        String id = objectMapper.readTree(created.getResponse().getContentAsByteArray()).path("id").asText();
        mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "expense-fixed-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        Map<String, Object> equivalent = new LinkedHashMap<>(body);
        equivalent.put("unitPrice", "3.3350");
        equivalent.put("quantity", "3.0");
        mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "expense-fixed-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(equivalent)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM ledger_entry WHERE id=:id")
                .param("id", UUID.fromString(id)).query(Long.class).single())).isOne();
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT last_unit_price FROM product WHERE id=:id")
                .param("id", PRODUCT).query(String.class).single())).isEqualTo("3.335");

        Map<String, Object> changed = new LinkedHashMap<>(body);
        changed.put("quantity", "4");
        mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "expense-fixed-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(changed)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
    }

    @Test @Order(4)
    void concurrentSameKeyCreatesExactlyOneExpense() throws Exception {
        Cookie user = login("t11-user", PASSWORD);
        String body = json(request(PRODUCT, NOW, "6.25", "2", "12.50"));
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<MvcResult>> futures = List.of(executor.submit(() -> {
                ready.countDown();
                start.await();
                return concurrentCreate(user, body);
            }), executor.submit(() -> {
                ready.countDown();
                start.await();
                return concurrentCreate(user, body);
            }));
            ready.await();
            start.countDown();
            MvcResult first = futures.get(0).get();
            MvcResult second = futures.get(1).get();
            assertThat(List.of(first.getResponse().getStatus(), second.getResponse().getStatus()))
                    .containsExactlyInAnyOrder(200, 201);
            String firstId = objectMapper.readTree(first.getResponse().getContentAsByteArray()).path("id").asText();
            String secondId = objectMapper.readTree(second.getResponse().getContentAsByteArray()).path("id").asText();
            assertThat(firstId).isEqualTo(secondId);
            assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql(
                            "SELECT count(*) FROM ledger_entry WHERE id=:id")
                    .param("id", UUID.fromString(firstId)).query(Long.class).single())).isOne();
        }
    }

    @Test @Order(5)
    void futureLimitInvalidReferencesAndAdminAccessFailClosed() throws Exception {
        Cookie user = login("t11-user", PASSWORD);
        Cookie admin = login("t11-admin", "T11-Admin-Formal-Password-2026");
        mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "future-too-far").contentType(MediaType.APPLICATION_JSON)
                        .content(json(request(PRODUCT, NOW.plusSeconds(5 * 60 + 1), "1", "1", "1"))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.occurredAt[0]").isNotEmpty());
        mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "foreign-product").contentType(MediaType.APPLICATION_JSON)
                        .content(json(request(OTHER_PRODUCT, NOW, "1", "1", "1"))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.productId[0]").isNotEmpty());
        mockMvc.perform(get("/api/v1/expenses/products").cookie(admin))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test @Order(6)
    void undoDeletesOnlyNewEntryAndRestoresPreviousRecentValues() throws Exception {
        Cookie user = login("t11-user", PASSWORD);
        MvcResult created = mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "undo-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(request(PRODUCT, NOW.minusSeconds(60), "8.8", "2", "17.6"))))
                .andExpect(status().isCreated()).andReturn();
        UUID id = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsByteArray()).path("id").asText());
        String expectedRecentPrice = tenantDatabase.execute(TENANT, () -> jdbc.sql("""
                SELECT unit_price FROM ledger_entry
                 WHERE product_id = :productId AND id <> :id AND entry_type = 'EXPENSE'
                   AND lifecycle_status = 'ACTIVE'
              ORDER BY created_at DESC, id DESC
                 LIMIT 1
                """).param("productId", PRODUCT).param("id", id).query(String.class).single());
        mockMvc.perform(delete("/api/v1/expenses/{id}/undo", id).with(csrf()).cookie(user)
                        .header("Idempotency-Key", "wrong-key"))
                .andExpect(status().isConflict());
        mockMvc.perform(delete("/api/v1/expenses/{id}/undo", id).with(csrf()).cookie(user)
                        .header("Idempotency-Key", "undo-key"))
                .andExpect(status().isNoContent());
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM ledger_entry WHERE id=:id")
                .param("id", id).query(Long.class).single())).isZero();
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT last_unit_price FROM product WHERE id=:id")
                .param("id", PRODUCT).query(String.class).single())).isEqualTo(expectedRecentPrice);
        mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "undo-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(request(PRODUCT, NOW.minusSeconds(60), "8.8", "2", "17.6"))))
                .andExpect(status().isCreated());
    }

    @Test @Order(7)
    void detailAndUpdateReuseValidationPreserveSnapshotsAndRejectStaleVersion() throws Exception {
        Cookie user = login("t11-user", PASSWORD);
        Map<String, Object> original = request(PRODUCT, NOW.minusSeconds(120), "10", "2", "19.50");
        MvcResult created = mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "edit-expense-create").contentType(MediaType.APPLICATION_JSON)
                        .content(json(original)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.version").value(0)).andReturn();
        String id = objectMapper.readTree(created.getResponse().getContentAsByteArray()).path("id").asText();
        mockMvc.perform(get("/api/v1/expenses/{id}", id).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.productName").value("早餐包"));

        tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("UPDATE expense_category SET display_name='餐食',normalized_name='餐食' WHERE id=:id")
                    .param("id", PRIMARY).update();
            return null;
        });
        Map<String, Object> changedEntry = new LinkedHashMap<>(original);
        changedEntry.put("productId", NORMALIZED_PRODUCT);
        changedEntry.put("unitPrice", "7.125");
        changedEntry.put("quantity", "2.5");
        changedEntry.put("paidAmount", "18.88");
        changedEntry.put("occurredAt", NOW.minusSeconds(86_400));
        changedEntry.put("note", "  编辑后备注  ");
        changedEntry.remove("secondaryCategoryId");
        changedEntry.remove("purchaseChannelId");
        changedEntry.remove("locationLabelId");
        Map<String, Object> update = Map.of("version", 0, "entry", changedEntry);
        mockMvc.perform(put("/api/v1/expenses/{id}", id).with(csrf()).cookie(user)
                        .header("Idempotency-Key", "edit-expense-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(update)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.productId").value(NORMALIZED_PRODUCT.toString()))
                .andExpect(jsonPath("$.productName").value("Coffee Latte"))
                .andExpect(jsonPath("$.unitPrice").value("7.125"))
                .andExpect(jsonPath("$.quantity").value("2.5"))
                .andExpect(jsonPath("$.calculatedAmount").value("17.81"))
                .andExpect(jsonPath("$.paidAmount").value("18.88"))
                .andExpect(jsonPath("$.primaryCategoryName").value("餐食"))
                .andExpect(jsonPath("$.secondaryCategoryId").doesNotExist())
                .andExpect(jsonPath("$.purchaseChannelId").doesNotExist())
                .andExpect(jsonPath("$.locationLabelId").doesNotExist())
                .andExpect(jsonPath("$.businessDate").value("2026-09-05"))
                .andExpect(jsonPath("$.note").value("编辑后备注"));
        mockMvc.perform(put("/api/v1/expenses/{id}", id).with(csrf()).cookie(user)
                        .header("Idempotency-Key", "edit-expense-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(update)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        mockMvc.perform(put("/api/v1/expenses/{id}", id).with(csrf()).cookie(user)
                        .header("Idempotency-Key", "stale-expense-key").contentType(MediaType.APPLICATION_JSON)
                        .content(json(update)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LEDGER_VERSION_CONFLICT"));

        Map<String, Object> invalidEntry = new LinkedHashMap<>(changedEntry);
        invalidEntry.put("quantity", "0");
        mockMvc.perform(put("/api/v1/expenses/{id}", id).with(csrf()).cookie(user)
                        .header("Idempotency-Key", "invalid-expense-edit").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("version", 1, "entry", invalidEntry))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.quantity[0]").exists());
        mockMvc.perform(put("/api/v1/expenses/{id}", id).with(csrf()).cookie(user)
                        .header("Idempotency-Key", "negative-expense-version").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("version", -1, "entry", changedEntry))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.version[0]").exists());
        mockMvc.perform(get("/api/v1/expenses/{id}", id).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.paidAmount").value("18.88"));
        mockMvc.perform(get("/api/v1/ledger-entries").queryParam("range", "THIS_YEAR")
                        .queryParam("query", "编辑后备注").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value(id))
                .andExpect(jsonPath("$.items[0].amount").value("18.88"));

        String untouchedSnapshot = tenantDatabase.execute(TENANT, () -> jdbc.sql("""
                SELECT primary_category_name_snapshot FROM ledger_entry
                 WHERE id<>:id AND product_id=:product ORDER BY created_at LIMIT 1
                """).param("id", UUID.fromString(id)).param("product", PRODUCT).query(String.class).single());
        assertThat(untouchedSnapshot).isEqualTo("餐饮");
        mockMvc.perform(get("/api/v1/expenses/{id}", UUID.randomUUID()).cookie(user))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("LEDGER_ENTRY_NOT_FOUND"));
        Cookie admin = login("t11-admin", "T11-Admin-Formal-Password-2026");
        mockMvc.perform(get("/api/v1/expenses/{id}", id).cookie(admin))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    private Map<String, Object> request(UUID productId, Instant occurredAt, String price, String quantity, String paid) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("productId", productId);
        body.put("primaryCategoryId", PRIMARY);
        body.put("secondaryCategoryId", SECONDARY);
        body.put("unitId", UNIT);
        body.put("unitPrice", price);
        body.put("quantity", quantity);
        body.put("paidAmount", paid);
        body.put("fundingChannelId", FUNDING);
        body.put("purchaseChannelId", PURCHASE);
        body.put("locationLabelId", LOCATION);
        body.put("occurredAt", occurredAt);
        body.put("note", "  早餐  ");
        return body;
    }

    private void insertDictionary(String table, UUID id, String name) {
        jdbc.sql("INSERT INTO " + table + "(tenant_id,id,display_name,normalized_name,status) "
                        + "VALUES (current_setting('app.tenant_id')::uuid,:id,:name,:name,'ACTIVE')")
                .param("id", id).param("name", name).update();
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

    private MvcResult concurrentCreate(Cookie user, String body) throws Exception {
        return mockMvc.perform(post("/api/v1/expenses").with(csrf()).cookie(user)
                        .header("Idempotency-Key", "concurrent-key").contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
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

    @TestConfiguration
    static class FixedClockConfiguration {
        @Bean @Primary
        Clock fixedExpenseClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }
    }
}
