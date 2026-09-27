package com.mybill.e2e;

import com.mybill.shared.persistence.TenantDatabaseExecutor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.Arrays;
import java.util.UUID;
import java.sql.DriverManager;

import static org.assertj.core.api.Assertions.assertThat;

/** 仅向脚本创建的一次性 PostgreSQL 集群写入 T28 浏览器回归数据。 */
@SpringBootTest(properties = {
        "spring.profiles.active=test",
        "my-bill.auth.bcrypt-strength=10",
        "my-bill.auth.rate-limit-pepper=t28-e2e-rate-limit-pepper",
        "my-bill.schema.validation-enabled=false"
})
@EnabledIfSystemProperty(named = "mybill.e2e.enabled", matches = "true")
@ContextConfiguration(initializers = E2eFixtureSeederTest.WriteGuard.class)
class E2eFixtureSeederTest {
    private static final UUID TENANT = uuid("e2800000-0000-4000-8000-000000000001");
    private static final UUID USER = uuid("e2800000-0000-4000-8000-000000000002");
    private static final UUID ADMIN = uuid("e2800000-0000-4000-8000-000000000003");
    private static final UUID CATEGORY = uuid("e2800000-0000-4000-8000-000000000004");
    private static final UUID UNIT = uuid("e2800000-0000-4000-8000-000000000005");
    private static final UUID FUNDING = uuid("e2800000-0000-4000-8000-000000000006");
    private static final UUID PRODUCT = uuid("e2800000-0000-4000-8000-000000000007");
    private static final UUID EXPENSE = uuid("e2800000-0000-4000-8000-000000000008");

    @Autowired JdbcClient jdbc;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired TenantDatabaseExecutor tenantDatabase;
    @Autowired Environment environment;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        String url = System.getProperty("mybill.test.jdbc-url");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> "my_bill_app");
        registry.add("spring.datasource.password", () -> "app_test");
        registry.add("spring.flyway.url", () -> url);
        registry.add("spring.flyway.user", () -> "my_bill_migration");
        registry.add("spring.flyway.password", () -> "migration_test");
    }

    @Test
    void seedOnlyTheExplicitEphemeralDatabase() {
        assertThat(System.getenv("MY_BILL_E2E_WRITE"))
                .as("E2E fixture write switch")
                .isEqualTo("1");
        assertThat(Arrays.asList(environment.getActiveProfiles()))
                .as("active Spring profiles")
                .contains("test");

        String expectedFingerprint = System.getenv("MY_BILL_E2E_EXPECTED_DB_FINGERPRINT");
        assertThat(expectedFingerprint).as("expected database fingerprint").isNotBlank();
        String actualFingerprint = jdbc.sql("""
                SELECT current_database() || '|' || inet_server_addr()::text || '|' ||
                       inet_server_port()::text || '|' || pg_postmaster_start_time()::text
                """).query(String.class).single();
        assertThat(actualFingerprint).as("live database fingerprint").isEqualTo(expectedFingerprint);

        assertThat(jdbc.sql("SELECT count(*) FROM tenant WHERE id=:id")
                .param("id", TENANT).query(Long.class).single()).isZero();
        jdbc.sql("INSERT INTO tenant(id) VALUES(:id)").param("id", TENANT).update();
        insertUser(USER, TENANT, "e2e-user", "E2E-Formal-Password-2026", "USER");
        insertUser(ADMIN, null, "e2e-admin", "E2E-Admin-Password-2026", "ADMIN");

        tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("""
                    INSERT INTO expense_category(tenant_id,id,display_name,normalized_name,status)
                    VALUES (current_setting('app.tenant_id')::uuid,:id,'发布候选分类','发布候选分类','ACTIVE')
                    """).param("id", CATEGORY).update();
            jdbc.sql("""
                    INSERT INTO unit(tenant_id,id,display_name,normalized_name,status)
                    VALUES (current_setting('app.tenant_id')::uuid,:id,'杯','杯','ACTIVE')
                    """).param("id", UNIT).update();
            jdbc.sql("""
                    INSERT INTO funding_channel(tenant_id,id,display_name,normalized_name,status)
                    VALUES (current_setting('app.tenant_id')::uuid,:id,'发布候选钱包','发布候选钱包','ACTIVE')
                    """).param("id", FUNDING).update();
            jdbc.sql("""
                    INSERT INTO product(tenant_id,id,display_name,normalized_name,default_primary_category_id,
                        default_unit_id,last_unit_price,last_quantity,last_funding_channel_id,status)
                    VALUES (current_setting('app.tenant_id')::uuid,:id,'发布候选咖啡','发布候选咖啡',
                        :category,:unit,18.50,1,:funding,'ACTIVE')
                    """).param("id", PRODUCT).param("category", CATEGORY).param("unit", UNIT)
                    .param("funding", FUNDING).update();
            jdbc.sql("""
                    INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,
                        product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,
                        unit_id,unit_name_snapshot,unit_price,quantity,calculated_amount,paid_amount,
                        funding_channel_id,funding_channel_name_snapshot,note)
                    VALUES (current_setting('app.tenant_id')::uuid,:id,'EXPENSE',CURRENT_TIMESTAMP,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date,:product,'发布候选咖啡',
                        :category,'发布候选分类',:unit,'杯',18.50,1,18.50,18.50,
                        :funding,'发布候选钱包','T28 隔离浏览器回归数据')
                    """).param("id", EXPENSE).param("product", PRODUCT).param("category", CATEGORY)
                    .param("unit", UNIT).param("funding", FUNDING).update();
            return null;
        });
    }

    private void insertUser(UUID id, UUID tenantId, String username, String password, String role) {
        jdbc.sql("""
                INSERT INTO app_user(id,username,password_digest,role,status,tenant_id)
                VALUES(:id,:username,:password,:role,'ACTIVE',:tenantId)
                """).param("id", id).param("username", username).param("password", passwordEncoder.encode(password))
                .param("role", role).param("tenantId", tenantId).update();
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }

    /** 在 Spring/Flyway 建立上下文并产生任何 schema 写入之前核对全部 E2E 门禁。 */
    static final class WriteGuard implements ApplicationContextInitializer<ConfigurableApplicationContext> {
        @Override
        public void initialize(ConfigurableApplicationContext context) {
            if (!context.getEnvironment().acceptsProfiles(Profiles.of("test"))) {
                throw new IllegalStateException("E2E fixture 只允许 test profile");
            }
            if (!"1".equals(System.getenv("MY_BILL_E2E_WRITE"))) {
                throw new IllegalStateException("E2E fixture 写开关未启用");
            }
            String expected = System.getenv("MY_BILL_E2E_EXPECTED_DB_FINGERPRINT");
            if (expected == null || expected.isBlank()) {
                throw new IllegalStateException("E2E fixture 缺少数据库指纹");
            }
            String url = System.getProperty("mybill.test.jdbc-url");
            if (url == null || url.isBlank()) {
                throw new IllegalStateException("E2E fixture 缺少测试数据库 URL");
            }
            try (var connection = DriverManager.getConnection(url, "my_bill_app", "app_test");
                 var statement = connection.createStatement();
                 var result = statement.executeQuery("""
                         SELECT current_database() || '|' || inet_server_addr()::text || '|' ||
                                inet_server_port()::text || '|' || pg_postmaster_start_time()::text
                         """)) {
                if (!result.next() || !expected.equals(result.getString(1))) {
                    throw new IllegalStateException("E2E fixture 数据库指纹不匹配");
                }
            } catch (Exception error) {
                if (error instanceof IllegalStateException stateError) throw stateError;
                throw new IllegalStateException("E2E fixture 数据库指纹校验失败", error);
            }
        }
    }
}
