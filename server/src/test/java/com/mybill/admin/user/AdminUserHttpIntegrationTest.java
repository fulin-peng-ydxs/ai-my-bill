package com.mybill.admin.user;

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
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** T7 在真实隔离 PostgreSQL 上验证已开放的账号生命周期、权限、会话和隐私 DTO。 */
@SpringBootTest(properties = {
        "my-bill.auth.bcrypt-strength=10",
        "my-bill.auth.rate-limit-pepper=test-admin-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false"
})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AdminUserHttpIntegrationTest {
    private static final UUID ADMIN = UUID.fromString("b2000000-0000-0000-0000-000000000001");
    private static final UUID ORDINARY_TENANT = UUID.fromString("b1000000-0000-0000-0000-000000000001");
    private static final UUID ORDINARY_USER = UUID.fromString("b2000000-0000-0000-0000-000000000002");
    private static final String ADMIN_PASSWORD = "T7-Admin-Formal-Password-2026";
    private static String managedUserId;
    private static String temporaryPassword;
    private static long version;

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
    void prepareSyntheticAdministratorAndPermissionProbeUser() {
        jdbc.sql("INSERT INTO tenant(id) VALUES (:id)").param("id", ORDINARY_TENANT).update();
        insertUser(ADMIN, null, "t7-admin", ADMIN_PASSWORD, "ADMIN");
        insertUser(ORDINARY_USER, ORDINARY_TENANT, "t7-ordinary", "T7-Ordinary-Password-2026", "USER");
    }

    @Test
    @Order(2)
    void ordinaryUserCannotReadOrMutateAdminUsers() throws Exception {
        Cookie ordinary = login("t7-ordinary", "T7-Ordinary-Password-2026", false);
        mockMvc.perform(get("/api/v1/admin/users").cookie(ordinary))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mockMvc.perform(post("/api/v1/admin/users").with(csrf()).cookie(ordinary)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("username", "forbidden-create"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @Order(3)
    void createCopiesDefaultsAndReturnsPasswordExactlyOnce() throws Exception {
        BrowserSession admin = browserLogin("t7-admin", ADMIN_PASSWORD);
        mockMvc.perform(get("/api/v1/admin/users").cookie(admin.session(), admin.csrf()))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Set-Cookie"));
        MvcResult result = mockMvc.perform(post("/api/v1/admin/users").with(csrf())
                        .cookie(admin.session())
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("username", "t7-managed"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.temporaryPassword").isString())
                .andExpect(jsonPath("$.user.status").value("PENDING_FIRST_LOGIN"))
                .andExpect(jsonPath("$.user.tenantId").doesNotExist())
                .andReturn();
        JsonNode response = objectMapper.readTree(result.getResponse().getContentAsByteArray());
        managedUserId = response.path("user").path("accountId").asText();
        temporaryPassword = response.path("temporaryPassword").asText();
        version = response.path("user").path("version").asLong();
        assertThat(temporaryPassword).hasSize(16);
        assertThat(response.path("expiresAt").asText()).isEqualTo(response.path("user").path("temporaryPasswordExpiresAt").asText());

        UUID tenantId = jdbc.sql("SELECT tenant_id FROM app_user WHERE id = :id")
                .param("id", UUID.fromString(managedUserId)).query(UUID.class).single();
        assertThat(tenantDatabase.execute(tenantId,
                () -> jdbc.sql("SELECT count(*) FROM income_category").query(Long.class).single())).isEqualTo(8);

        mockMvc.perform(post("/api/v1/admin/users").with(csrf()).cookie(admin.session())
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("username", "t7-managed"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("USERNAME_ALREADY_EXISTS"))
                .andExpect(jsonPath("$.fieldErrors.username[0]").value("该用户名已存在"));
    }

    @Test
    @Order(4)
    void listUsesStrictPrivacyDtoAndSupportsStatusFilter() throws Exception {
        Cookie admin = login("t7-admin", ADMIN_PASSWORD, false);
        MvcResult result = mockMvc.perform(get("/api/v1/admin/users")
                        .queryParam("query", "t7-managed").queryParam("status", "PENDING_FIRST_LOGIN").cookie(admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1)).andReturn();
        JsonNode user = objectMapper.readTree(result.getResponse().getContentAsByteArray()).path("items").get(0);
        assertThat(toFieldSet(user)).containsExactlyInAnyOrder("accountId", "username", "status", "registeredAt",
                "temporaryPasswordExpiresAt", "version");
        assertThat(user.toString()).doesNotContain("tenant", "ledger", "amount", "payer", "location", "product");
        mockMvc.perform(get("/api/v1/admin/users").queryParam("query", "%").cookie(admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(get("/api/v1/admin/users").queryParam("status", "NOT_A_STATUS").cookie(admin))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(get("/api/v1/admin/users").queryParam("page", "1000001").cookie(admin))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    @Order(5)
    void lifecycleRevokesSessionsRejectsStaleVersionsAndPermanentlyDeletesTheAccount() throws Exception {
        Cookie admin = login("t7-admin", ADMIN_PASSWORD, false);
        Cookie firstUserSession = login("t7-managed", temporaryPassword, true);

        JsonNode disabled = postAction(admin, "disable", version, 200);
        version = disabled.path("version").asLong();
        mockMvc.perform(get("/api/v1/auth/session").cookie(firstUserSession)).andExpect(status().isUnauthorized());
        postAction(admin, "restore", 1, 409);

        JsonNode restored = postAction(admin, "restore", version, 200);
        version = restored.path("version").asLong();
        Cookie secondUserSession = login("t7-managed", temporaryPassword, true);

        JsonNode reset = postAction(admin, "reset-password", version, 200);
        version = reset.path("user").path("version").asLong();
        String resetPassword = reset.path("temporaryPassword").asText();
        assertThat(resetPassword).hasSize(16).isNotEqualTo(temporaryPassword);
        mockMvc.perform(get("/api/v1/auth/session").cookie(secondUserSession)).andExpect(status().isUnauthorized());
        Cookie resetSession = login("t7-managed", resetPassword, true);

        UUID tenantId = jdbc.sql("SELECT tenant_id FROM app_user WHERE id = :id")
                .param("id", UUID.fromString(managedUserId)).query(UUID.class).single();
        postAction(admin, "deletion", version - 1, 409);
        mockMvc.perform(get("/api/v1/auth/session").cookie(resetSession)).andExpect(status().isOk());
        JsonNode deletion = postAction(admin, "deletion", version, 200);
        String reference = deletion.path("deletionReference").asText();
        assertThat(reference).isNotBlank();
        mockMvc.perform(get("/api/v1/auth/session").cookie(resetSession)).andExpect(status().isUnauthorized());
        assertThat(jdbc.sql("SELECT count(*) FROM app_user WHERE id = :id")
                .param("id", UUID.fromString(managedUserId)).query(Long.class).single()).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM tenant WHERE id = :id")
                .param("id", tenantId).query(Long.class).single()).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM account_deletion_audit WHERE id = :id AND actor_type='ADMIN'")
                .param("id", UUID.fromString(reference)).query(Long.class).single()).isOne();

        String audits = jdbc.sql("SELECT string_agg(action || object_id || safe_summary::text, ',') FROM admin_audit_log WHERE action='DELETE_USER_ACCOUNT'")
                .query(String.class).single();
        assertThat(audits).contains("DELETE_USER_ACCOUNT", reference, "DELETED")
                .doesNotContain(managedUserId, "t7-managed", temporaryPassword, resetPassword, "tenant_id");
    }

    private JsonNode postAction(Cookie admin, String action, long expectedVersion, int expectedStatus) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/admin/users/{id}/{action}", managedUserId, action)
                        .with(csrf()).cookie(admin).contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("version", expectedVersion))))
                .andExpect(status().is(expectedStatus)).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private Cookie login(String username, String password, boolean passwordChangeRequired) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", password))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.passwordChangeRequired").value(passwordChangeRequired)).andReturn();
        Cookie cookie = result.getResponse().getCookie("MY_BILL_SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }

    private BrowserSession browserLogin(String username, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", password))))
                .andExpect(status().isOk()).andReturn();
        Cookie sessionCookie = result.getResponse().getCookie("MY_BILL_SESSION");
        Cookie refreshedCsrf = result.getResponse().getCookie("XSRF-TOKEN");
        assertThat(sessionCookie).isNotNull();
        assertThat(refreshedCsrf).isNotNull();
        return new BrowserSession(sessionCookie, refreshedCsrf);
    }

    private record BrowserSession(Cookie session, Cookie csrf) { }

    private void insertUser(UUID id, UUID tenantId, String username, String password, String role) {
        jdbc.sql("""
                        INSERT INTO app_user(id, username, password_digest, role, tenant_id)
                        VALUES (:id, :username, :digest, :role, :tenantId)
                        """).param("id", id).param("username", username).param("digest", passwordEncoder.encode(password))
                .param("role", role).param("tenantId", tenantId).update();
    }

    private Set<String> toFieldSet(JsonNode node) {
        java.util.LinkedHashSet<String> fields = new java.util.LinkedHashSet<>();
        node.fieldNames().forEachRemaining(fields::add);
        return fields;
    }

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }
}
