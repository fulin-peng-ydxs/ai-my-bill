package com.mybill.preference;

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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "my-bill.auth.bcrypt-strength=10",
        "my-bill.auth.rate-limit-pepper=test-preference-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false"
})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PreferenceHttpIntegrationTest {
    private static final UUID TENANT = UUID.fromString("d1000000-0000-4000-8000-000000000001");
    private static final UUID OTHER_TENANT = UUID.fromString("d1000000-0000-4000-8000-000000000002");
    private static final UUID USER = UUID.fromString("d2000000-0000-4000-8000-000000000001");
    private static final UUID OTHER_USER = UUID.fromString("d2000000-0000-4000-8000-000000000002");
    private static final UUID ADMIN = UUID.fromString("d2000000-0000-4000-8000-000000000003");
    private static final UUID ACTIVE_CHANNEL = UUID.fromString("d3000000-0000-4000-8000-000000000001");
    private static final UUID INACTIVE_CHANNEL = UUID.fromString("d3000000-0000-4000-8000-000000000002");
    private static final String PASSWORD = "T10-User-Formal-Password-2026";

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
    void prepareSyntheticPrincipalsAndChannels() {
        jdbc.sql("INSERT INTO tenant(id) VALUES (:tenant), (:other)")
                .param("tenant", TENANT).param("other", OTHER_TENANT).update();
        insertUser(USER, TENANT, "t10-user", PASSWORD, "USER");
        insertUser(OTHER_USER, OTHER_TENANT, "t10-other", PASSWORD, "USER");
        insertUser(ADMIN, null, "t10-admin", "T10-Admin-Formal-Password-2026", "ADMIN");
        tenantDatabase.execute(TENANT, () -> jdbc.sql("""
                INSERT INTO funding_channel(tenant_id, id, display_name, normalized_name, status)
                VALUES (current_setting('app.tenant_id')::uuid, :active, '银行卡', '银行卡', 'ACTIVE'),
                       (current_setting('app.tenant_id')::uuid, :inactive, '旧卡', '旧卡', 'INACTIVE')
                """).param("active", ACTIVE_CHANNEL).param("inactive", INACTIVE_CHANNEL).update());
    }

    @Test @Order(2)
    void defaultsAreReturnedWithoutCreatingARecordAndAdminIsForbidden() throws Exception {
        Cookie user = login("t10-user", PASSWORD);
        Cookie admin = login("t10-admin", "T10-Admin-Formal-Password-2026");
        mockMvc.perform(get("/api/v1/preferences").cookie(user))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.defaultFundingChannelId").doesNotExist())
                .andExpect(jsonPath("$.ledgerDefaultRange").value("TODAY"))
                .andExpect(jsonPath("$.reportDefaultRange").value("THIS_MONTH"))
                .andExpect(jsonPath("$.themeMode").value("SYSTEM"))
                .andExpect(jsonPath("$.recentEntryType").value("EXPENSE"));
        mockMvc.perform(get("/api/v1/preferences").cookie(admin))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM user_preference")
                .query(Long.class).single())).isZero();
    }

    @Test @Order(3)
    void preferencesRoundTripAndRemainIsolatedByAuthenticatedUser() throws Exception {
        Cookie user = login("t10-user", PASSWORD);
        mockMvc.perform(put("/api/v1/preferences").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of(
                                "defaultFundingChannelId", ACTIVE_CHANNEL,
                                "ledgerDefaultRange", "THIS_WEEK", "reportDefaultRange", "THIS_YEAR",
                                "themeMode", "DARK", "recentEntryType", "INCOME"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.defaultFundingChannelId").value(ACTIVE_CHANNEL.toString()))
                .andExpect(jsonPath("$.defaultFundingChannelName").value("银行卡"))
                .andExpect(jsonPath("$.recentEntryType").value("INCOME"));
        mockMvc.perform(get("/api/v1/preferences").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.themeMode").value("DARK"));
        Cookie other = login("t10-other", PASSWORD);
        mockMvc.perform(get("/api/v1/preferences").cookie(other))
                .andExpect(status().isOk()).andExpect(jsonPath("$.themeMode").value("SYSTEM"));
    }

    @Test @Order(4)
    void inactiveForeignAndMalformedValuesAreRejectedWithoutChangingSavedValues() throws Exception {
        Cookie user = login("t10-user", PASSWORD);
        mockMvc.perform(put("/api/v1/preferences").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of(
                                "defaultFundingChannelId", INACTIVE_CHANNEL,
                                "ledgerDefaultRange", "TODAY", "reportDefaultRange", "THIS_MONTH",
                                "themeMode", "LIGHT", "recentEntryType", "EXPENSE"))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors.defaultFundingChannelId[0]").isNotEmpty());
        mockMvc.perform(put("/api/v1/preferences").with(csrf()).cookie(user)
                        .contentType(MediaType.APPLICATION_JSON).content(json(Map.of(
                                "ledgerDefaultRange", "FOREVER", "reportDefaultRange", "THIS_MONTH",
                                "themeMode", "LIGHT", "recentEntryType", "EXPENSE"))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mockMvc.perform(get("/api/v1/preferences").cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.themeMode").value("DARK"));
    }

    @Test @Order(5)
    void resetDeletesOnlyCurrentUsersPreference() throws Exception {
        Cookie user = login("t10-user", PASSWORD);
        mockMvc.perform(post("/api/v1/preferences/reset").with(csrf()).cookie(user))
                .andExpect(status().isOk()).andExpect(jsonPath("$.themeMode").value("SYSTEM"));
        assertThat(tenantDatabase.execute(TENANT, () -> jdbc.sql("SELECT count(*) FROM user_preference")
                .query(Long.class).single())).isZero();
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
