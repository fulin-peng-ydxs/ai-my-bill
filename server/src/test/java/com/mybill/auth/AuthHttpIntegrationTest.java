package com.mybill.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.sql.Timestamp;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** T3 真实 PostgreSQL 认证闭环，不使用内存用户、模拟会话或共享业务数据库。 */
@SpringBootTest(properties = {
        "my-bill.auth.bcrypt-strength=10",
        "my-bill.auth.max-login-failures=3",
        "my-bill.auth.rate-limit-pepper=test-auth-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false"
})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AuthHttpIntegrationTest {

    private static final UUID TENANT_A = UUID.fromString("a1000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("a1000000-0000-0000-0000-000000000002");
    private static final UUID TENANT_TEMP = UUID.fromString("a1000000-0000-0000-0000-000000000003");
    private static final UUID TENANT_DISABLED = UUID.fromString("a1000000-0000-0000-0000-000000000004");
    private static final UUID TENANT_EXPIRED = UUID.fromString("a1000000-0000-0000-0000-000000000005");
    private static final UUID USER_A = UUID.fromString("a2000000-0000-0000-0000-000000000001");
    private static final UUID USER_B = UUID.fromString("a2000000-0000-0000-0000-000000000002");
    private static final UUID TEMP_USER = UUID.fromString("a2000000-0000-0000-0000-000000000003");
    private static final UUID ADMIN = UUID.fromString("a2000000-0000-0000-0000-000000000004");
    private static final UUID DISABLED_USER = UUID.fromString("a2000000-0000-0000-0000-000000000005");
    private static final UUID EXPIRED_USER = UUID.fromString("a2000000-0000-0000-0000-000000000006");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private TenantTransactionExecutor tenantTransactions;

    @Autowired
    private SessionTokenService tokenService;

    @Autowired
    private RateLimitSubjectHasher rateLimitSubjectHasher;

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
    void prepareSyntheticAccounts() {
        jdbc.sql("""
                        INSERT INTO tenant(id) VALUES
                            (:tenantA), (:tenantB), (:tenantTemp), (:tenantDisabled), (:tenantExpired)
                        """)
                .param("tenantA", TENANT_A)
                .param("tenantB", TENANT_B)
                .param("tenantTemp", TENANT_TEMP)
                .param("tenantDisabled", TENANT_DISABLED)
                .param("tenantExpired", TENANT_EXPIRED)
                .update();
        insertUser(USER_A, TENANT_A, "alice", "Alice-Formal-Password-2026", null, "USER");
        insertUser(USER_B, TENANT_B, "bob", "Bob-Formal-Password-2026", null, "USER");
        insertUser(TEMP_USER, TENANT_TEMP, "temporary-user", "Temp-Password-01",
                Instant.now().plus(24, ChronoUnit.HOURS), "USER");
        insertUser(ADMIN, null, "system-admin", "Admin-Formal-Password-2026", null, "ADMIN");
        insertUser(DISABLED_USER, TENANT_DISABLED, "disabled-user", "Disabled-Password-2026",
                null, "USER", "DISABLED");
        insertUser(EXPIRED_USER, TENANT_EXPIRED, "expired-user", "Expired-Temp-01",
                Instant.now().minus(1, ChronoUnit.HOURS), "USER");
    }

    @Test
    @Order(2)
    void publicSurfaceIssuesCsrfAndDefaultsUnknownApiToDenied() throws Exception {
        MvcResult health = mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("XSRF-TOKEN=")))
                .andReturn();
        Cookie csrfCookie = health.getResponse().getCookie("XSRF-TOKEN");
        assertThat(csrfCookie).isNotNull();
        mockMvc.perform(get("/api/v1/auth/session"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", "alice", "password", "Alice-Formal-Password-2026"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));
        mockMvc.perform(post("/api/v1/auth/login")
                        .cookie(csrfCookie)
                        .header("X-XSRF-TOKEN", csrfCookie.getValue())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", "csrf-probe", "password", "wrong-password"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        mockMvc.perform(get("/api/v1/not-registered"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @Order(3)
    void loginUsesOpaqueCookieAndRoleAuthorization() throws Exception {
        Cookie userCookie = loginWithBrowserCsrf("alice", "Alice-Formal-Password-2026", false);
        String persistedDigest = jdbc.sql("SELECT token_digest FROM user_session WHERE user_id = :userId")
                .param("userId", USER_A)
                .query(String.class).single();
        assertThat(persistedDigest)
                .isEqualTo(tokenService.digest(userCookie.getValue()))
                .isNotEqualTo(userCookie.getValue());
        mockMvc.perform(get("/api/v1/auth/session").cookie(userCookie))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andExpect(jsonPath("$.accountId").value(USER_A.toString()))
                .andExpect(jsonPath("$.role").value("USER"))
                .andExpect(jsonPath("$.tenantId").doesNotExist());
        mockMvc.perform(get("/api/v1/admin/probe").cookie(userCookie))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        Cookie adminCookie = login("system-admin", "Admin-Formal-Password-2026", false);
        mockMvc.perform(get("/api/v1/admin/probe").cookie(adminCookie))
                .andExpect(status().isNotFound());
    }

    @Test
    @Order(4)
    void temporaryPasswordRequiresChangeAndRotatesTheSession() throws Exception {
        Cookie oldCookie = login("temporary-user", "Temp-Password-01", true);
        mockMvc.perform(get("/api/v1/admin/probe").cookie(oldCookie))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_REQUIRED"));

        mockMvc.perform(post("/api/v1/auth/first-password")
                        .with(csrf())
                        .cookie(oldCookie)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("newPassword", "passwordpassword"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PASSWORD_POLICY_VIOLATION"));

        MvcResult changed = mockMvc.perform(post("/api/v1/auth/first-password")
                        .with(csrf())
                        .cookie(oldCookie)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("newPassword", "Temporary-Formal-Password-2026"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.passwordChangeRequired").value(false))
                .andReturn();
        Cookie newCookie = changed.getResponse().getCookie("MY_BILL_SESSION");
        assertThat(newCookie).isNotNull();

        mockMvc.perform(get("/api/v1/auth/session").cookie(oldCookie))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/session").cookie(newCookie))
                .andExpect(status().isOk());
    }

    @Test
    @Order(5)
    void passwordChangeRevokesEveryPreviousSessionAndLogoutRevokesTheReplacement() throws Exception {
        Cookie first = login("bob", "Bob-Formal-Password-2026", false);
        Cookie second = login("bob", "Bob-Formal-Password-2026", false);
        MvcResult changed = mockMvc.perform(post("/api/v1/auth/password")
                        .with(csrf())
                        .cookie(first)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of(
                                "currentPassword", "Bob-Formal-Password-2026",
                                "newPassword", "Bob-Replaced-Password-2026"))))
                .andExpect(status().isOk())
                .andReturn();
        Cookie replacement = changed.getResponse().getCookie("MY_BILL_SESSION");
        assertThat(replacement).isNotNull();

        mockMvc.perform(get("/api/v1/auth/session").cookie(first)).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/session").cookie(second)).andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/logout").with(csrf()).cookie(replacement))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
        mockMvc.perform(get("/api/v1/auth/session").cookie(replacement)).andExpect(status().isUnauthorized());
    }

    @Test
    @Order(6)
    void unknownUsernameIsRateLimitedWithoutPersistingPlainIdentity() throws Exception {
        for (int attempt = 0; attempt < 3; attempt++) {
            mockMvc.perform(post("/api/v1/auth/login")
                            .with(csrf())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("username", "missing-user", "password", "wrong-password"))))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        }
        mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", "missing-user", "password", "wrong-password"))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("LOGIN_RATE_LIMITED"));

        String persistedSubject = jdbc.sql("SELECT subject_digest FROM auth_rate_limit LIMIT 1")
                .query(String.class).single();
        assertThat(persistedSubject).hasSize(64).doesNotContain("missing-user");

        String previousWindowSubject = rateLimitSubjectHasher.digest("window-boundary-user");
        jdbc.sql("""
                        INSERT INTO auth_rate_limit(
                            id, entry_point, subject_digest, window_started_at,
                            failure_count, locked_until, updated_at
                        ) VALUES (
                            :id, 'LOGIN', :subjectDigest, CURRENT_TIMESTAMP - INTERVAL '15 minutes',
                            3, CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
                        )
                        """)
                .param("id", UUID.randomUUID())
                .param("subjectDigest", previousWindowSubject)
                .update();
        mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of(
                                "username", "window-boundary-user",
                                "password", "wrong-password"))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("LOGIN_RATE_LIMITED"));
    }

    @Test
    @Order(7)
    void disabledAndExpiredTemporaryAccountsFailWithoutCreatingSessions() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", "disabled-user", "password", "Disabled-Password-2026"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_UNAVAILABLE"));
        mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", "expired-user", "password", "Expired-Temp-01"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TEMPORARY_PASSWORD_EXPIRED"));
        assertThat(jdbc.sql("""
                        SELECT count(*) FROM user_session
                        WHERE user_id IN (:disabledUser, :expiredUser)
                        """)
                .param("disabledUser", DISABLED_USER)
                .param("expiredUser", EXPIRED_USER)
                .query(Long.class).single()).isZero();
    }

    @Test
    @Order(8)
    void expiredSessionIsRejectedAndCleared() throws Exception {
        Cookie session = login("alice", "Alice-Formal-Password-2026", false);
        jdbc.sql("UPDATE user_session SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE token_digest = :digest")
                .param("digest", tokenService.digest(session.getValue()))
                .update();
        mockMvc.perform(get("/api/v1/auth/session").cookie(session))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
    }

    @Test
    @Order(9)
    void tenantContextIsTransactionScopedAcrossReuseAndRollback() {
        CurrentPrincipal alice = principal(USER_A, TENANT_A, "alice");
        CurrentPrincipal bob = principal(USER_B, TENANT_B, "bob");
        UUID unitA = UUID.fromString("a3000000-0000-0000-0000-000000000001");

        tenantTransactions.execute(alice, () -> jdbc.sql("""
                        INSERT INTO unit(tenant_id, id, display_name, normalized_name)
                        VALUES (:tenantId, :id, '个', '个')
                        """)
                .param("tenantId", TENANT_A)
                .param("id", unitA)
                .update());
        assertThat(tenantTransactions.execute(alice,
                () -> jdbc.sql("SELECT count(*) FROM unit").query(Long.class).single())).isEqualTo(1);
        assertThat(tenantTransactions.execute(bob,
                () -> jdbc.sql("SELECT count(*) FROM unit").query(Long.class).single())).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM unit").query(Long.class).single()).isZero();

        assertThatThrownBy(() -> tenantTransactions.execute(alice, () -> {
            jdbc.sql("DELETE FROM unit WHERE id = :id").param("id", unitA).update();
            throw new IllegalStateException("force rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(tenantTransactions.execute(alice,
                () -> jdbc.sql("SELECT count(*) FROM unit").query(Long.class).single())).isEqualTo(1);
        assertThatThrownBy(() -> tenantTransactions.execute(
                new CurrentPrincipal(UUID.randomUUID(), ADMIN, null, 1, "system-admin",
                        CurrentPrincipal.Role.ADMIN, false), () -> 1))
                .isInstanceOf(IllegalStateException.class);
    }

    private void insertUser(UUID id, UUID tenantId, String username, String password,
                            Instant temporaryExpiry, String role) {
        insertUser(id, tenantId, username, password, temporaryExpiry, role, "ACTIVE");
    }

    private void insertUser(UUID id, UUID tenantId, String username, String password,
                            Instant temporaryExpiry, String role, String status) {
        jdbc.sql("""
                        INSERT INTO app_user(
                            id, username, password_digest, temporary_password_expires_at,
                            role, status, tenant_id, credential_version
                        ) VALUES (:id, :username, :passwordDigest, :temporaryExpiry,
                                  :role, :status, :tenantId, 1)
                        """)
                .param("id", id)
                .param("username", username)
                .param("passwordDigest", passwordEncoder.encode(password))
                .param("temporaryExpiry", temporaryExpiry == null ? null : Timestamp.from(temporaryExpiry))
                .param("role", role)
                .param("status", status)
                .param("tenantId", tenantId)
                .update();
    }

    private Cookie login(String username, String password, boolean passwordChangeRequired) throws Exception {
        return expectSuccessfulLogin(mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", password)))),
                username, passwordChangeRequired);
    }

    private Cookie loginWithBrowserCsrf(String username, String password, boolean passwordChangeRequired)
            throws Exception {
        Cookie csrfCookie = mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getCookie("XSRF-TOKEN");
        assertThat(csrfCookie).isNotNull();
        return expectSuccessfulLogin(mockMvc.perform(post("/api/v1/auth/login")
                        .cookie(csrfCookie)
                        .header("X-XSRF-TOKEN", csrfCookie.getValue())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", password)))),
                username, passwordChangeRequired);
    }

    private Cookie expectSuccessfulLogin(ResultActions action, String username, boolean passwordChangeRequired)
            throws Exception {
        MvcResult result = action
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.passwordChangeRequired").value(passwordChangeRequired))
                .andExpect(jsonPath("$.rawToken").doesNotExist())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("MY_BILL_SESSION="),
                        org.hamcrest.Matchers.containsString("HttpOnly"),
                        org.hamcrest.Matchers.containsString("SameSite=Lax"))))
                .andReturn();
        Cookie cookie = result.getResponse().getCookie("MY_BILL_SESSION");
        assertThat(cookie).isNotNull();
        return cookie;
    }

    private CurrentPrincipal principal(UUID userId, UUID tenantId, String username) {
        return new CurrentPrincipal(UUID.randomUUID(), userId, tenantId, 1, username,
                CurrentPrincipal.Role.USER, false);
    }

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }
}
