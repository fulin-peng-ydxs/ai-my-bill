package com.mybill.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
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

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "my-bill.auth.bcrypt-strength=10", "my-bill.auth.rate-limit-pepper=t19-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false", "my-bill.jobs.poll-delay-ms=600000"
})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AccountDeletionHttpIntegrationTest {
    private static final Path EXPORT_ROOT = Path.of("target", "t19-deletion-test").toAbsolutePath();
    private static final UUID TENANT = UUID.fromString("19100000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString("19200000-0000-4000-8000-000000000001");
    private static final UUID ADMIN = UUID.fromString("19200000-0000-4000-8000-000000000002");
    private static final UUID EXPORT = UUID.fromString("19300000-0000-4000-8000-000000000001");
    private static final String USERNAME = "t19-self-user";
    private static final String PASSWORD = "T19-Formal-Password-2026";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired TenantDatabaseExecutor tenantDatabase;
    @Autowired AccountDeletionFileRecovery fileRecovery;
    private Cookie firstSession;
    private Cookie secondSession;
    private Cookie adminSession;
    private Path exportFile;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test");
        registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration");
        registry.add("spring.flyway.password", () -> "migration_test");
        registry.add("my-bill.export.directory", () -> EXPORT_ROOT.toString());
    }

    @BeforeAll
    static void requireDatabase() {
        assertThat(System.getProperty("mybill.test.jdbc-url")).isNotBlank();
    }

    @Test @Order(1)
    void prepareAccountWithMultipleSessionsLedgerDataAndExportFile() throws Exception {
        Files.createDirectories(EXPORT_ROOT.resolve(TENANT.toString()));
        exportFile = EXPORT_ROOT.resolve(TENANT.toString()).resolve(EXPORT + ".csv");
        Files.writeString(exportFile, "private export");
        jdbc.sql("INSERT INTO tenant(id) VALUES(:id)").param("id", TENANT).update();
        insertUser(USER, TENANT, USERNAME, "USER");
        insertUser(ADMIN, null, "t19-admin", "ADMIN");
        tenantDatabase.execute(TENANT, () -> {
            UUID funding = UUID.fromString("19400000-0000-4000-8000-000000000001");
            jdbc.sql("INSERT INTO funding_channel(tenant_id,id,display_name,normalized_name,status) VALUES(current_setting('app.tenant_id')::uuid,:id,'现金','现金','ACTIVE')")
                    .param("id", funding).update();
            jdbc.sql("INSERT INTO export_job(tenant_id,id,user_id,filter_snapshot,status,file_location,expires_at) VALUES(current_setting('app.tenant_id')::uuid,:id,:user,'{}','SUCCEEDED',:file,now()+interval '1 day')")
                    .param("id", EXPORT).param("user", USER).param("file", exportFile.toString()).update();
            return null;
        });
        Path interrupted = exportFile.resolveSibling(exportFile.getFileName()
                + ".deleting-19300000-0000-4000-8000-000000000099");
        Files.move(exportFile, interrupted);
        assertThat(fileRecovery.recover()).isOne();
        assertThat(exportFile).hasContent("private export");
        firstSession = login(USERNAME);
        secondSession = login(USERNAME);
        adminSession = login("t19-admin");
        assertThat(jdbc.sql("SELECT count(*) FROM user_session WHERE user_id=:id").param("id", USER).query(Long.class).single()).isEqualTo(2);
    }

    @Test @Order(2)
    void rejectsWrongConfirmationAnonymousAndAdministratorWithoutChangingData() throws Exception {
        delete(firstSession, "wrong-user", 400).andExpect(jsonPath("$.code").value("DELETION_CONFIRMATION_MISMATCH"));
        mockMvc.perform(post("/api/v1/me/deletion").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsBytes(Map.of("confirmation", USERNAME))))
                .andExpect(status().isUnauthorized());
        delete(adminSession, "t19-admin", 403);
        assertThat(jdbc.sql("SELECT count(*) FROM app_user WHERE id=:id").param("id", USER).query(Long.class).single()).isOne();
        assertThat(exportFile).exists();
    }

    @Test @Order(3)
    void deletesOnlineIdentityTenantSessionsDataAndExportWhileKeepingOnlyAnonymousAudit() throws Exception {
        MvcResult result = delete(firstSession, USERNAME, 200).andReturn();
        JsonNode response = mapper.readTree(result.getResponse().getContentAsByteArray());
        UUID reference = UUID.fromString(response.path("deletionReference").asText());

        mockMvc.perform(get("/api/v1/auth/session").cookie(firstSession)).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/session").cookie(secondSession)).andExpect(status().isUnauthorized());
        assertThat(exportFile).doesNotExist();
        Path interrupted = exportFile.resolveSibling(exportFile.getFileName() + ".deleting-" + reference);
        Files.writeString(interrupted, "private export");
        assertThat(fileRecovery.recover()).isOne();
        assertThat(interrupted).doesNotExist();
        assertThat(jdbc.sql("SELECT count(*) FROM app_user WHERE id=:id").param("id", USER).query(Long.class).single()).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM tenant WHERE id=:id").param("id", TENANT).query(Long.class).single()).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM user_session WHERE user_id=:id").param("id", USER).query(Long.class).single()).isZero();

        Map<String, Object> audit = jdbc.sql("SELECT actor_type,subject_digest,status,requested_at,expires_at,result_summary FROM account_deletion_audit WHERE id=:id")
                .param("id", reference).query().singleRow();
        assertThat(audit.get("actor_type")).isEqualTo("SELF");
        assertThat(audit.get("status")).isEqualTo("SUCCEEDED");
        assertThat(audit.get("subject_digest").toString()).matches("[0-9a-f]{64}")
                .doesNotContain(USER.toString().replace("-", ""));
        Instant requestedAt = ((Timestamp) audit.get("requested_at")).toInstant();
        Instant expiresAt = ((Timestamp) audit.get("expires_at")).toInstant();
        assertThat(Duration.between(requestedAt, expiresAt)).isEqualTo(Duration.ofDays(180));
        assertThat(audit.toString()).doesNotContain(USER.toString(), TENANT.toString(), USERNAME, "private export");
        assertThat(jdbc.sql("SELECT count(*) FROM job_run WHERE job_type='PURGE_ACCOUNT_DELETION_AUDIT'")
                .query(Long.class).single()).isGreaterThanOrEqualTo(1);
    }

    @AfterAll
    void cleanupFiles() throws Exception {
        if (!Files.exists(EXPORT_ROOT)) return;
        try (var paths = Files.walk(EXPORT_ROOT)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }

    private org.springframework.test.web.servlet.ResultActions delete(Cookie session, String confirmation, int expected) throws Exception {
        return mockMvc.perform(post("/api/v1/me/deletion").with(csrf()).cookie(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsBytes(Map.of("confirmation", confirmation))))
                .andExpect(status().is(expected));
    }

    private Cookie login(String username) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsBytes(Map.of("username", username, "password", PASSWORD))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("MY_BILL_SESSION");
    }

    private void insertUser(UUID id, UUID tenantId, String username, String role) {
        jdbc.sql("INSERT INTO app_user(id,username,password_digest,role,tenant_id) VALUES(:id,:username,:password,:role,:tenant)")
                .param("id", id).param("username", username).param("password", passwordEncoder.encode(PASSWORD))
                .param("role", role).param("tenant", tenantId).update();
    }
}
