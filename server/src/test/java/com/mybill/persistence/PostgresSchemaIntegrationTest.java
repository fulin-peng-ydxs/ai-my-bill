package com.mybill.persistence;

import com.mybill.job.JdbcJobRunRepository;
import com.mybill.persistence.config.SchemaVersionGuard;
import com.mybill.persistence.config.SchemaVersionProperties;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * T2 数据库真实契约：空库/重复迁移、seed 不覆盖、复合归属、RLS 以及调整并发上限。
 */
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@EnabledIfSystemProperty(named = "mybill.test.jdbc-url", matches = ".+")
class PostgresSchemaIntegrationTest {

    private static String jdbcUrl;
    private static String adminUsername;
    private static String adminPassword;
    private static Flyway flyway;

    @BeforeAll
    static void migrateEmptyDatabase() throws SQLException {
        jdbcUrl = System.getProperty("mybill.test.jdbc-url");
        adminUsername = System.getProperty("mybill.test.admin-user");
        adminPassword = System.getProperty("mybill.test.admin-password", "");
        executeAdmin("DO $$ BEGIN "
                + "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='my_bill_app') THEN "
                + "CREATE ROLE my_bill_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; "
                + "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='my_bill_migration') THEN "
                + "CREATE ROLE my_bill_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$");
        executeAdmin("ALTER ROLE my_bill_app PASSWORD 'app_test'");
        executeAdmin("ALTER ROLE my_bill_migration PASSWORD 'migration_test'");
        executeAdmin("GRANT USAGE, CREATE ON SCHEMA public TO my_bill_migration");
        flyway = Flyway.configure().dataSource(jdbcUrl, "my_bill_migration", "migration_test")
                .target("008").load();
        assertThat(flyway.migrate().migrationsExecuted).isEqualTo(8);
        executeAdmin("INSERT INTO tenant(id) VALUES ('09000000-0000-0000-0000-000000000001')");
        executeAdmin("INSERT INTO product(tenant_id,id,display_name,normalized_name,updated_at) VALUES "
                + "('09000000-0000-0000-0000-000000000001','09000000-0000-0000-0000-000000000002','旧商品','旧商品','2026-01-01T00:00:00Z'),"
                + "('09000000-0000-0000-0000-000000000001','09000000-0000-0000-0000-000000000003','新商品','新商品','2026-02-01T00:00:00Z')");
        flyway = Flyway.configure().dataSource(jdbcUrl, "my_bill_migration", "migration_test").load();
        assertThat(flyway.migrate().migrationsExecuted).isEqualTo(2);
        assertThat(queryAdminString("SELECT string_agg(display_name || ':' || sort_order, ',' ORDER BY sort_order) "
                + "FROM product WHERE tenant_id='09000000-0000-0000-0000-000000000001'"))
                .isEqualTo("新商品:0,旧商品:10");
        executeAdmin("DELETE FROM product WHERE tenant_id='09000000-0000-0000-0000-000000000001'");
        executeAdmin("DELETE FROM tenant WHERE id='09000000-0000-0000-0000-000000000001'");
    }

    @Test
    @Order(1)
    void repeatMigrationPreservesAdministratorEditedSeed() throws Exception {
        executeAdmin("UPDATE default_dictionary_item SET display_name = '工资收入' WHERE stable_key = 'salary'");

        assertThat(flyway.migrate().migrationsExecuted).isZero();
        assertThat(queryAdminString("SELECT display_name FROM default_dictionary_item WHERE stable_key = 'salary'"))
                .isEqualTo("工资收入");
        assertThat(queryAdminLong("SELECT count(*) FROM default_dictionary_item WHERE dictionary_type = 'INCOME_CATEGORY'"))
                .isEqualTo(8);
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement()) {
            connection.setAutoCommit(false);
            statement.execute(readResource("db/rollback/U006__confirmed_default_seed.sql"));
            assertThat(singleLong(statement, "SELECT count(*) FROM default_dictionary_item WHERE stable_key='salary'"))
                    .isEqualTo(1);
            connection.rollback();
        }
    }

    @Test
    @Order(2)
    void runtimeRoleAndPoliciesAreFailClosed() throws SQLException {
        assertThat(queryAdminString("SELECT rolcanlogin::text || ':' || rolsuper::text || ':' || rolcreatedb::text || ':' || "
                + "rolcreaterole::text || ':' || rolinherit::text || ':' || rolbypassrls::text FROM pg_roles WHERE rolname = 'my_bill_app'"))
                .isEqualTo("true:false:false:false:false:false");
        assertThat(queryAdminString("SELECT rolcanlogin::text || ':' || rolsuper::text || ':' || rolcreatedb::text || ':' || "
                + "rolcreaterole::text || ':' || rolinherit::text || ':' || rolbypassrls::text FROM pg_roles WHERE rolname = 'my_bill_migration'"))
                .isEqualTo("true:false:false:false:false:false");
        assertThat(queryAdminLong("SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner "
                + "WHERE c.relkind='r' AND c.relnamespace='public'::regnamespace AND r.rolname='my_bill_migration'"))
                .isGreaterThanOrEqualTo(24);
        assertThat(queryAdminString("SELECT r.rolname FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='public'"))
                .isEqualTo("my_bill_migration");
        assertThat(queryAdminString("SELECT has_table_privilege('my_bill_app','default_dictionary_item','UPDATE')::text || ':' || "
                + "has_table_privilege('my_bill_app','admin_audit_log','UPDATE')::text || ':' || "
                + "has_table_privilege('my_bill_app','admin_audit_log','DELETE')::text"))
                .isEqualTo("true:false:false");
        assertThat(queryAdminLong("SELECT count(*) FROM pg_class WHERE relrowsecurity AND relforcerowsecurity AND relname IN "
                + "('expense_category','unit','funding_channel','purchase_channel','location_label','income_category','payer','product',"
                + "'ledger_entry','expense_adjustment','daily_entry_template','user_preference','idempotency_record','export_job','account_deletion_job',"
                + "'product_merge_event')"))
                .isEqualTo(16);

        String tenantA = "10000000-0000-0000-0000-000000000001";
        String tenantB = "10000000-0000-0000-0000-000000000002";
        executeAdmin("INSERT INTO tenant(id) VALUES ('" + tenantA + "'), ('" + tenantB + "')");
        executeAdmin("INSERT INTO unit(tenant_id,id,display_name,normalized_name) VALUES "
                + "('" + tenantA + "','20000000-0000-0000-0000-000000000001','个','个'),"
                + "('" + tenantB + "','20000000-0000-0000-0000-000000000002','件','件')");

        try (Connection app = appConnection(); Statement statement = app.createStatement()) {
            assertThat(singleLong(statement, "SELECT count(*) FROM unit")).isZero();
            app.setAutoCommit(false);
            statement.execute("SELECT set_config('app.tenant_id', '" + tenantA + "', true)");
            assertThat(singleLong(statement, "SELECT count(*) FROM unit")).isEqualTo(1);
            assertThatThrownBy(() -> statement.executeUpdate(
                    "INSERT INTO unit(tenant_id,id,display_name,normalized_name) VALUES "
                            + "('" + tenantB + "','20000000-0000-0000-0000-000000000003','箱','箱')"))
                    .isInstanceOf(SQLException.class);
            app.rollback();
            assertThat(singleLong(statement, "SELECT count(*) FROM unit")).isZero();
            statement.execute("SELECT set_config('app.tenant_id', 'not-a-uuid', true)");
            assertThatThrownBy(() -> singleLong(statement, "SELECT count(*) FROM unit"))
                    .isInstanceOf(SQLException.class);
            app.rollback();
            assertThatThrownBy(() -> statement.execute("ALTER TABLE unit DISABLE ROW LEVEL SECURITY"))
                    .isInstanceOf(SQLException.class);
            app.rollback();
        }
    }

    @Test
    @Order(3)
    void compositeOwnershipAndFinancialLifecycleHoldUnderConcurrency() throws Exception {
        String tenantA = "10000000-0000-0000-0000-000000000001";
        String tenantB = "10000000-0000-0000-0000-000000000002";
        String primaryA = "30000000-0000-0000-0000-000000000001";
        String primaryB = "30000000-0000-0000-0000-000000000002";
        String fundingA = "40000000-0000-0000-0000-000000000001";
        String productA = "50000000-0000-0000-0000-000000000001";
        String expenseA = "70000000-0000-0000-0000-000000000001";
        executeAdmin("INSERT INTO expense_category(tenant_id,id,display_name,normalized_name) VALUES "
                + "('" + tenantA + "','" + primaryA + "','餐饮','餐饮'),('" + tenantB + "','" + primaryB + "','出行','出行')");
        executeAdmin("INSERT INTO expense_category(tenant_id,id,parent_id,display_name,normalized_name) VALUES "
                + "('" + tenantA + "','30000000-0000-0000-0000-000000000003','" + primaryA + "','咖啡饮品','咖啡饮品')");
        assertThatThrownBy(() -> executeAdmin("INSERT INTO expense_category(tenant_id,id,parent_id,display_name,normalized_name) VALUES "
                + "('" + tenantA + "','30000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000003','三级','三级')"))
                .isInstanceOf(SQLException.class);
        executeAdmin("INSERT INTO funding_channel(tenant_id,id,display_name,normalized_name) VALUES "
                + "('" + tenantA + "','" + fundingA + "','现金','现金')");
        executeAdmin("INSERT INTO product(tenant_id,id,display_name,normalized_name,default_primary_category_id,default_unit_id) VALUES "
                + "('" + tenantA + "','" + productA + "','咖啡','咖啡','" + primaryA + "','20000000-0000-0000-0000-000000000001')");

        assertThatThrownBy(() -> executeAdmin("INSERT INTO product(tenant_id,id,display_name,normalized_name,default_primary_category_id) VALUES "
                + "('" + tenantA + "','50000000-0000-0000-0000-000000000002','非法引用','非法引用','" + primaryB + "')"))
                .isInstanceOf(SQLException.class);

        executeAdmin(expenseInsert(tenantA, expenseA, productA, primaryA, fundingA));
        assertThatThrownBy(() -> executeAdmin("UPDATE ledger_entry SET product_name_snapshot=NULL WHERE tenant_id='"
                + tenantA + "' AND id='" + expenseA + "'"))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> executeAdmin("UPDATE ledger_entry SET unit_price=NULL WHERE tenant_id='"
                + tenantA + "' AND id='" + expenseA + "'"))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> executeAdmin(expenseInsert(tenantA,
                "70000000-0000-0000-0000-000000000002", productA, primaryA, fundingA)
                .replace("'100.0000','1.000'", "'100.00001','1.000'")))
                .isInstanceOf(SQLException.class);
        String adjustmentOne = adjustmentInsert(tenantA, "80000000-0000-0000-0000-000000000001", expenseA, "60.00");
        String adjustmentTwo = adjustmentInsert(tenantA, "80000000-0000-0000-0000-000000000002", expenseA, "50.00");

        try (Connection first = adminConnection(); Connection second = adminConnection();
             var executor = Executors.newSingleThreadExecutor()) {
            first.setAutoCommit(false);
            second.setAutoCommit(false);
            first.createStatement().executeUpdate(adjustmentOne);
            var blockedInsert = executor.submit(() -> second.createStatement().executeUpdate(adjustmentTwo));
            assertThatThrownBy(() -> blockedInsert.get(Duration.ofMillis(200).toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS))
                    .isInstanceOf(java.util.concurrent.TimeoutException.class);
            first.commit();
            assertThatThrownBy(blockedInsert::get)
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(SQLException.class);
            second.rollback();
        }

        assertThatThrownBy(() -> executeAdmin("UPDATE ledger_entry SET paid_amount='50.00' WHERE tenant_id='"
                + tenantA + "' AND id='" + expenseA + "'"))
                .isInstanceOf(SQLException.class);

        executeAdmin("UPDATE ledger_entry SET lifecycle_status='TRASHED', deleted_at=CURRENT_TIMESTAMP, "
                + "purge_after=CURRENT_TIMESTAMP + INTERVAL '30 days' WHERE tenant_id='" + tenantA + "' AND id='" + expenseA + "'");
        assertThat(queryAdminString("SELECT status FROM expense_adjustment WHERE tenant_id='" + tenantA + "'"))
                .isEqualTo("SOURCE_FROZEN");
        executeAdmin("UPDATE ledger_entry SET lifecycle_status='ACTIVE', deleted_at=NULL, purge_after=NULL "
                + "WHERE tenant_id='" + tenantA + "' AND id='" + expenseA + "'");
        assertThat(queryAdminString("SELECT status FROM expense_adjustment WHERE tenant_id='" + tenantA + "'"))
                .isEqualTo("EFFECTIVE");
    }

    @Test
    @Order(4)
    void dailyTemplateBusinessKeyUpdatesOneRow() throws SQLException {
        String tenant = "10000000-0000-0000-0000-000000000001";
        String template = "90000000-0000-0000-0000-000000000001";
        String base = "INSERT INTO daily_entry_template(tenant_id,id,entry_type,display_name,normalized_name,source_record_id,"
                + "product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,"
                + "unit_price,quantity,paid_amount,funding_channel_id,funding_channel_name_snapshot) VALUES ";
        executeAdmin(base + "('" + tenant + "','" + template + "','EXPENSE','咖啡','咖啡',"
                + "'70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','咖啡',"
                + "'30000000-0000-0000-0000-000000000001','餐饮','20000000-0000-0000-0000-000000000001','个',"
                + "'20.0000','1.000','20.00','40000000-0000-0000-0000-000000000001','现金') "
                + "ON CONFLICT (tenant_id,entry_type,normalized_name) DO UPDATE SET paid_amount=EXCLUDED.paid_amount");
        executeAdmin(base + "('" + tenant + "','" + UUID.randomUUID() + "','EXPENSE','咖啡','咖啡',"
                + "'70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','咖啡',"
                + "'30000000-0000-0000-0000-000000000001','餐饮','20000000-0000-0000-0000-000000000001','个',"
                + "'25.0000','1.000','25.00','40000000-0000-0000-0000-000000000001','现金') "
                + "ON CONFLICT (tenant_id,entry_type,normalized_name) DO UPDATE SET paid_amount=EXCLUDED.paid_amount");
        assertThat(queryAdminLong("SELECT count(*) FROM daily_entry_template WHERE tenant_id='" + tenant + "' AND normalized_name='咖啡'"))
                .isEqualTo(1);
        assertThat(queryAdminString("SELECT paid_amount::text FROM daily_entry_template WHERE tenant_id='" + tenant + "' AND normalized_name='咖啡'"))
                .isEqualTo("25.00");
        assertThatThrownBy(() -> executeAdmin("UPDATE daily_entry_template SET paid_amount=NULL WHERE tenant_id='"
                + tenant + "' AND normalized_name='咖啡'"))
                .isInstanceOf(SQLException.class);
    }

    @Test
    @Order(5)
    void jobLeaseIsClaimedOnceRecoveredAndAuditIsAppendOnly() throws Exception {
        DriverManagerDataSource appDataSource = new DriverManagerDataSource(jdbcUrl, "my_bill_app", "app_test");
        JdbcJobRunRepository jobs = new JdbcJobRunRepository(JdbcClient.create(appDataSource));
        var now = java.time.Instant.parse("2026-09-05T12:00:00Z");
        UUID runId = jobs.schedule("T6_TEST", null, "same-batch", 3, now);
        assertThat(jobs.schedule("T6_TEST", null, "same-batch", 3, now)).isEqualTo(runId);

        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> jobs.claimNext(java.util.List.of("T6_TEST"), "worker-a", now, now.plusSeconds(30)));
            var second = executor.submit(() -> jobs.claimNext(java.util.List.of("T6_TEST"), "worker-b", now, now.plusSeconds(30)));
            var claims = java.util.List.of(first.get(), second.get());
            assertThat(claims.stream().filter(java.util.Optional::isPresent).count()).isEqualTo(1);
            var claimed = claims.stream().flatMap(java.util.Optional::stream).findFirst().orElseThrow();
            assertThatThrownBy(() -> jobs.requestCancellation(runId, false, now.plusSeconds(1)))
                    .isInstanceOf(IllegalStateException.class);
            assertThat(jobs.requestCancellation(runId, true, now.plusSeconds(1))).isEqualTo("CANCEL_REQUESTED");
            jobs.cancel(runId, claimed.leaseOwner(), 0, now.plusSeconds(2));
        }

        UUID expiredId = jobs.schedule("T6_TEST", null, "expired-batch", 3, now);
        jobs.claimNext(java.util.List.of("T6_TEST"), "dead-worker", now, now.plusSeconds(30)).orElseThrow();
        executeAdmin("UPDATE job_run SET lease_expires_at='2026-09-05T11:59:59Z' WHERE id='" + expiredId + "'");
        assertThat(jobs.findExpired(now)).extracting(run -> run.id()).contains(expiredId);
        assertThat(jobs.recoverExpired(expiredId, true, "LEASE_EXPIRED", now)).isTrue();
        assertThat(jobs.recoverExpired(expiredId, true, "LEASE_EXPIRED", now)).isFalse();
        assertThat(jobs.find(expiredId).orElseThrow().status()).isEqualTo("PENDING");

        String administrator = "60000000-0000-0000-0000-000000000001";
        executeAdmin("INSERT INTO app_user(id,username,password_digest,role) VALUES ('" + administrator
                + "','t6-admin','not-a-real-password-digest','ADMIN')");
        try (Connection app = appConnection(); Statement statement = app.createStatement()) {
            statement.executeUpdate("INSERT INTO admin_audit_log(id,administrator_user_id,action,object_type,object_id,result,safe_summary) "
                    + "VALUES ('60000000-0000-0000-0000-000000000002','" + administrator
                    + "','T6_TEST','JOB','" + runId + "','SUCCEEDED','{\"changes\":{}}')");
            assertThatThrownBy(() -> statement.executeUpdate("UPDATE admin_audit_log SET result='FAILED' WHERE id="
                    + "'60000000-0000-0000-0000-000000000002'"))
                    .isInstanceOf(SQLException.class);
        }
        executeAdmin("DELETE FROM job_run WHERE job_type='T6_TEST'");
        executeAdmin("DELETE FROM admin_audit_log WHERE administrator_user_id='" + administrator + "'");
        executeAdmin("DELETE FROM app_user WHERE id='" + administrator + "'");
    }

    @Test
    @Order(6)
    void runtimeSchemaGuardAcceptsOnlyTheExpectedVersion() {
        DriverManagerDataSource appDataSource = new DriverManagerDataSource(jdbcUrl, "my_bill_app", "app_test");
        JdbcClient appJdbc = JdbcClient.create(appDataSource);

        new SchemaVersionGuard(appJdbc, new SchemaVersionProperties(true, "010")).run(null);
        assertThatThrownBy(() -> new SchemaVersionGuard(
                appJdbc, new SchemaVersionProperties(true, "8")).run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("期望 8")
                .hasMessageContaining("实际 010");
    }

    @Test
    @Order(7)
    void documentedRollbackScriptsAreExecutableInAnEmptyEnvironment() throws Exception {
        executeAdmin("TRUNCATE tenant CASCADE");
        executeAdmin("UPDATE default_dictionary_item SET display_name='工资' WHERE stable_key='salary'");
        for (int version = 10; version >= 1; version--) {
            executeAdmin(readResource(String.format("db/rollback/U%03d__%s.sql", version, rollbackName(version))));
        }
        assertThat(queryAdminLong("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
                + "AND table_name <> 'flyway_schema_history'"))
                .isZero();
    }

    private static String expenseInsert(String tenant, String expense, String product, String category, String funding) {
        return "INSERT INTO ledger_entry(tenant_id,id,entry_type,business_time,business_date,product_id,product_name_snapshot,"
                + "primary_category_id,primary_category_name_snapshot,unit_id,unit_name_snapshot,unit_price,quantity,calculated_amount,"
                + "paid_amount,funding_channel_id,funding_channel_name_snapshot) VALUES ('" + tenant + "','" + expense + "','EXPENSE',"
                + "'2026-09-05T10:00:00+08:00','2026-09-05','" + product + "','咖啡','" + category + "','餐饮',"
                + "'20000000-0000-0000-0000-000000000001','个','100.0000','1.000','100.00','100.00','" + funding + "','现金')";
    }

    private static String adjustmentInsert(String tenant, String id, String expense, String amount) {
        return "INSERT INTO expense_adjustment(tenant_id,id,original_expense_id,adjustment_type,amount,business_time,business_date) "
                + "VALUES ('" + tenant + "','" + id + "','" + expense + "','REFUND','" + amount
                + "','2026-09-05T11:00:00+08:00','2026-09-05')";
    }

    private static Connection adminConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, adminUsername, adminPassword);
    }

    private static Connection appConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, "my_bill_app", "app_test");
    }

    private static void executeAdmin(String sql) throws SQLException {
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static String readResource(String path) throws IOException {
        try (InputStream input = PostgresSchemaIntegrationTest.class.getClassLoader().getResourceAsStream(path)) {
            if (input == null) {
                throw new IOException("missing test resource " + path);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String rollbackName(int version) {
        return switch (version) {
            case 1 -> "identity_and_sessions";
            case 2 -> "personal_dictionaries_and_products";
            case 3 -> "ledger_and_adjustments";
            case 4 -> "templates_preferences_exports_jobs_audit";
            case 5 -> "query_and_lifecycle_indexes";
            case 6 -> "confirmed_default_seed";
            case 7 -> "tenant_rls_policies";
            case 8 -> "job_execution_contract";
            case 9 -> "product_sort_order";
            case 10 -> "product_merge_and_default_dictionary_normalization";
            default -> throw new IllegalArgumentException("unsupported rollback version " + version);
        };
    }

    private static long queryAdminLong(String sql) throws SQLException {
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement()) {
            return singleLong(statement, sql);
        }
    }

    private static String queryAdminString(String sql) throws SQLException {
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getString(1);
        }
    }

    private static long singleLong(Statement statement, String sql) throws SQLException {
        try (ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getLong(1);
        }
    }
}
