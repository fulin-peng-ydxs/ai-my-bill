package com.mybill.ledger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybill.job.JobBatchResult;
import com.mybill.job.JobExecutionContext;
import com.mybill.shared.persistence.TenantDatabaseExecutor;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.io.BufferedWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T26 可复现容量基线。仅由 check:performance 在一次性 PostgreSQL 集群运行，避免日常单测写入大样本。
 */
@SpringBootTest(properties = {"my-bill.schema.validation-enabled=false", "my-bill.jobs.poll-delay-ms=3600000"})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "mybill.performance.enabled", matches = "true")
class PerformanceBaselineIntegrationTest {
    private static final UUID TENANT = UUID.fromString("c1000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString("c1100000-0000-4000-8000-000000000001");
    private static final UUID SESSION = UUID.fromString("c1200000-0000-4000-8000-000000000001");
    private static final String SESSION_TOKEN = "t26-performance-session-token";
    private static final UUID CATEGORY = UUID.fromString("c2000000-0000-4000-8000-000000000001");
    private static final UUID UNIT = UUID.fromString("c2100000-0000-4000-8000-000000000001");
    private static final UUID FUNDING = UUID.fromString("c2200000-0000-4000-8000-000000000001");
    private static final UUID PAYER = UUID.fromString("c2300000-0000-4000-8000-000000000001");
    private static final UUID INCOME_CATEGORY = UUID.fromString("c2400000-0000-4000-8000-000000000001");
    private static final int PRODUCT_COUNT = 2_000;
    private static final int ACTIVE_EXPENSE_COUNT = 40_000;
    private static final int ACTIVE_INCOME_COUNT = 10_000;
    private static final int EXPIRED_TRASH_COUNT = 1_000;

    @Autowired JdbcClient jdbc;
    @Autowired TenantDatabaseExecutor tenantDatabase;
    @Autowired ExportCsvWriter exportCsvWriter;
    @Autowired ExpiredLedgerPurgeJob purgeJob;
    @Autowired ObjectMapper objectMapper;
    @Autowired MockMvc mockMvc;

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

    @Test
    void recordsRepresentativePlansStreamingExportAndBoundedCleanup() throws Exception {
        long seedStarted = System.nanoTime();
        seedRepresentativeTenant();
        analyzeFixture();
        long seedMillis = elapsedMillis(seedStarted);

        List<Map<String, Object>> results = new ArrayList<>();
        results.add(plan("candidate-search", """
                SELECT p.id,p.display_name,pc.id AS primary_id,pc.display_name AS primary_name,
                       sc.id AS secondary_id,sc.display_name AS secondary_name,
                       u.id AS unit_id,u.display_name AS unit_name,p.last_unit_price,
                       f.id AS funding_id,f.display_name AS funding_name,
                       ch.id AS purchase_id,ch.display_name AS purchase_name
                FROM product p
                LEFT JOIN expense_category pc ON pc.id=p.default_primary_category_id AND pc.status='ACTIVE'
                LEFT JOIN expense_category sc ON sc.id=p.default_secondary_category_id
                  AND sc.parent_id=pc.id AND sc.status='ACTIVE'
                LEFT JOIN unit u ON u.id=p.default_unit_id AND u.status='ACTIVE'
                LEFT JOIN funding_channel f ON f.id=p.last_funding_channel_id AND f.status='ACTIVE'
                LEFT JOIN purchase_channel ch ON ch.id=p.last_purchase_channel_id AND ch.status='ACTIVE'
                WHERE p.status='ACTIVE' AND p.normalized_name LIKE '%性能商品 1999%' ESCAPE '\\'
                ORDER BY p.updated_at DESC,p.display_name,p.id LIMIT 20
                """, null));
        results.add(plan("ledger-index-probe", """
                SELECT id FROM ledger_entry
                WHERE tenant_id=current_setting('app.tenant_id')::uuid AND lifecycle_status='ACTIVE'
                  AND business_date BETWEEN DATE '2024-01-01' AND DATE '2026-12-31'
                ORDER BY business_date DESC,business_time DESC,created_at DESC,id DESC LIMIT 20
                """, "idx_ledger_active_cursor"));
        results.add(plan("expense-category-report", """
                WITH expenses AS (
                  SELECT l.* FROM ledger_entry l
                  WHERE l.tenant_id=current_setting('app.tenant_id')::uuid
                    AND l.entry_type='EXPENSE' AND l.lifecycle_status='ACTIVE'
                    AND l.business_date BETWEEN DATE '2024-01-01' AND DATE '2026-12-31'
                )
                SELECT '一级分类' AS group_name,primary_category_name_snapshot AS label,
                       primary_category_id::text AS value,sum(paid_amount) AS amount,count(*) AS item_count
                FROM expenses GROUP BY 1,2,3 ORDER BY amount DESC,label,value LIMIT 50
                """, null));
        results.add(plan("expired-trash-claim", """
                SELECT id FROM ledger_entry
                WHERE tenant_id=current_setting('app.tenant_id')::uuid AND lifecycle_status='TRASHED'
                  AND purge_after <= CURRENT_TIMESTAMP
                ORDER BY purge_after,id LIMIT 100 FOR UPDATE SKIP LOCKED
                """, "idx_ledger_purge_due"));

        Map<String, Object> formalPaths = measureFormalHttpPaths();

        long exportStarted = System.nanoTime();
        long exported = tenantDatabase.execute(TENANT, () -> {
            try (BufferedWriter writer = new BufferedWriter(Writer.nullWriter())) {
                return exportCsvWriter.write(allDataSnapshot(), writer,
                        new JobExecutionContext(UUID.randomUUID(), TENANT, "t26-export", () -> false, () -> { }));
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
        });
        long exportMillis = elapsedMillis(exportStarted);
        assertThat(exported).isEqualTo(ACTIVE_EXPENSE_COUNT + ACTIVE_INCOME_COUNT + EXPIRED_TRASH_COUNT);

        long purgeStarted = System.nanoTime();
        int batches = 0;
        long purged = 0;
        JobExecutionContext purgeContext = new JobExecutionContext(
                UUID.randomUUID(), TENANT, "t26-purge", () -> false, () -> { });
        while (batches < 20) {
            JobBatchResult batch = tenantDatabase.execute(TENANT, () -> purgeJob.executeBatch(purgeContext));
            batches++;
            assertThat(batch.processedCount()).isBetween(0L, 100L);
            purged += batch.processedCount();
            if (batch.completed()) break;
        }
        long purgeMillis = elapsedMillis(purgeStarted);
        assertThat(purged).isEqualTo(EXPIRED_TRASH_COUNT);
        assertThat(batches).isEqualTo(11);

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("dataset", Map.of(
                "products", PRODUCT_COUNT,
                "activeExpenses", ACTIVE_EXPENSE_COUNT,
                "activeIncomes", ACTIVE_INCOME_COUNT,
                "expiredTrash", EXPIRED_TRASH_COUNT));
        report.put("seedMillis", seedMillis);
        report.put("plans", results);
        report.put("formalHttpPaths", formalPaths);
        report.put("streamingExport", Map.of("rows", exported, "elapsedMillis", exportMillis, "fetchSize", 200));
        report.put("expiredCleanup", Map.of("rows", purged, "elapsedMillis", purgeMillis,
                "batches", batches, "maximumBatchSize", 100));
        Path output = Path.of("target", "performance-baseline.json");
        Files.createDirectories(output.getParent());
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(output.toFile(), report);
        System.out.println("T26 performance baseline: " + objectMapper.writeValueAsString(report));
    }

    private void seedRepresentativeTenant() {
        jdbc.sql("INSERT INTO tenant(id) VALUES(:tenant)").param("tenant", TENANT).update();
        tenantDatabase.execute(TENANT, () -> {
            jdbc.sql("""
                    INSERT INTO app_user(id,username,password_digest,role,tenant_id)
                    VALUES(:id,'t26-user','not-used-by-session-auth','USER',current_setting('app.tenant_id')::uuid)
                    """).param("id", USER).update();
            jdbc.sql("""
                    INSERT INTO user_session(id,user_id,token_digest,credential_version,expires_at)
                    VALUES(:id,:userId,:digest,1,TIMESTAMPTZ '2099-01-01 00:00:00Z')
                    """).param("id", SESSION).param("userId", USER).param("digest", sha256(SESSION_TOKEN)).update();
            jdbc.sql("INSERT INTO expense_category(tenant_id,id,display_name,normalized_name) VALUES(current_setting('app.tenant_id')::uuid,:id,'日常','日常')")
                    .param("id", CATEGORY).update();
            jdbc.sql("INSERT INTO unit(tenant_id,id,display_name,normalized_name) VALUES(current_setting('app.tenant_id')::uuid,:id,'个','个')")
                    .param("id", UNIT).update();
            jdbc.sql("INSERT INTO funding_channel(tenant_id,id,display_name,normalized_name) VALUES(current_setting('app.tenant_id')::uuid,:id,'银行卡','银行卡')")
                    .param("id", FUNDING).update();
            jdbc.sql("INSERT INTO payer(tenant_id,id,display_name,normalized_name) VALUES(current_setting('app.tenant_id')::uuid,:id,'单位','单位')")
                    .param("id", PAYER).update();
            jdbc.sql("INSERT INTO income_category(tenant_id,id,display_name,normalized_name) VALUES(current_setting('app.tenant_id')::uuid,:id,'工资','工资')")
                    .param("id", INCOME_CATEGORY).update();
            jdbc.sql("""
                    INSERT INTO product(tenant_id,id,display_name,normalized_name,sort_order,status)
                    SELECT current_setting('app.tenant_id')::uuid,
                      ('c3000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
                      '性能商品 ' || lpad(i::text,4,'0'),'性能商品 ' || lpad(i::text,4,'0'),i*10,'ACTIVE'
                    FROM generate_series(1,:count) i
                    """).param("count", PRODUCT_COUNT).update();
            insertExpenses("c4000000", ACTIVE_EXPENSE_COUNT, false);
            insertIncomes();
            insertExpenses("c6000000", EXPIRED_TRASH_COUNT, true);
            return null;
        });
    }

    private Map<String, Object> measureFormalHttpPaths() throws Exception {
        Cookie session = new Cookie("MY_BILL_SESSION", SESSION_TOKEN);
        Map<String, Object> result = new LinkedHashMap<>();

        long candidateStarted = System.nanoTime();
        mockMvc.perform(get("/api/v1/expenses/products").param("query", "性能商品 1999").cookie(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1));
        result.put("candidateMillis", elapsedMicros(candidateStarted) / 1_000.0);

        long ledgerStarted = System.nanoTime();
        mockMvc.perform(get("/api/v1/ledger-entries").param("range", "CUSTOM")
                        .param("startDate", "2024-01-01").param("endDate", "2026-12-31").cookie(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(20));
        result.put("ledgerFirstPageMillis", elapsedMicros(ledgerStarted) / 1_000.0);

        long reportStarted = System.nanoTime();
        mockMvc.perform(get("/api/v1/reports/expenses").param("dimension", "CATEGORY")
                .param("range", "CUSTOM").param("startDate", "2024-01-01")
                        .param("endDate", "2026-12-31").cookie(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.points.length()").value(1));
        result.put("expenseCategoryReportMillis", elapsedMicros(reportStarted) / 1_000.0);
        return result;
    }

    private void insertExpenses(String prefix, int count, boolean trashed) {
        jdbc.sql("""
                WITH source AS (
                  SELECT i,TIMESTAMPTZ '2024-01-01 00:00:00+08'
                    + ((i % 730) * INTERVAL '1 day') + ((i % 86400) * INTERVAL '1 second') AS occurred
                  FROM generate_series(1,:count) i
                )
                INSERT INTO ledger_entry(
                  tenant_id,id,entry_type,business_time,business_date,lifecycle_status,deleted_at,purge_after,
                  product_id,product_name_snapshot,primary_category_id,primary_category_name_snapshot,
                  unit_id,unit_name_snapshot,unit_price,quantity,calculated_amount,paid_amount,
                  funding_channel_id,funding_channel_name_snapshot,note,created_at,updated_at)
                SELECT current_setting('app.tenant_id')::uuid,
                  (:prefix || '-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'EXPENSE',occurred,
                  (occurred AT TIME ZONE 'Asia/Shanghai')::date,:status,
                  CASE WHEN :trashed THEN TIMESTAMPTZ '2025-01-01 00:00:00Z' END,
                  CASE WHEN :trashed THEN TIMESTAMPTZ '2025-01-31 00:00:00Z' END,
                  ('c3000000-0000-4000-8000-' || lpad(((i-1)%:products+1)::text,12,'0'))::uuid,
                  '性能商品 ' || lpad(((i-1)%:products+1)::text,4,'0'),:category,'日常',:unit,'个',
                  10.00,1.000,10.00,10.00,:funding,'银行卡','合成性能数据',occurred,occurred
                FROM source
                """).param("count", count).param("prefix", prefix)
                .param("status", trashed ? "TRASHED" : "ACTIVE").param("trashed", trashed)
                .param("products", PRODUCT_COUNT).param("category", CATEGORY).param("unit", UNIT)
                .param("funding", FUNDING).update();
    }

    private void insertIncomes() {
        jdbc.sql("""
                WITH source AS (
                  SELECT i,TIMESTAMPTZ '2024-01-01 00:00:00+08'
                    + ((i % 730) * INTERVAL '1 day') + ((i % 86400) * INTERVAL '1 second') AS occurred
                  FROM generate_series(1,:count) i
                )
                INSERT INTO ledger_entry(
                  tenant_id,id,entry_type,business_time,business_date,income_name,payer_id,payer_name_snapshot,
                  income_category_id,income_category_name_snapshot,income_amount,funding_channel_id,
                  funding_channel_name_snapshot,note,created_at,updated_at)
                SELECT current_setting('app.tenant_id')::uuid,
                  ('c5000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'INCOME',occurred,
                  (occurred AT TIME ZONE 'Asia/Shanghai')::date,'性能收入 ' || (i%20),:payer,'单位',
                  :category,'工资',100.00,:funding,'银行卡','合成性能数据',occurred,occurred
                FROM source
                """).param("count", ACTIVE_INCOME_COUNT).param("payer", PAYER)
                .param("category", INCOME_CATEGORY).param("funding", FUNDING).update();
    }

    private void analyzeFixture() throws Exception {
        try (var connection = DriverManager.getConnection(System.getProperty("mybill.test.jdbc-url"),
                "my_bill_migration", "migration_test"); var statement = connection.createStatement()) {
            statement.execute("ANALYZE product,ledger_entry,expense_adjustment");
        }
    }

    private Map<String, Object> plan(String name, String sql, String requiredIndex) {
        return tenantDatabase.execute(TENANT, () -> {
            String json = jdbc.sql("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + sql).query(String.class).single();
            try {
                JsonNode root = objectMapper.readTree(json).get(0);
                String planText = root.path("Plan").toString();
                if (requiredIndex != null) assertThat(planText).contains(requiredIndex);
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("name", name);
                result.put("planningMillis", root.path("Planning Time").asDouble());
                result.put("executionMillis", root.path("Execution Time").asDouble());
                result.put("topNode", root.path("Plan").path("Node Type").asText());
                result.put("actualRows", root.path("Plan").path("Actual Rows").asLong());
                result.put("requiredIndex", requiredIndex == null ? "planner-choice" : requiredIndex);
                return result;
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
        });
    }

    private static ExportContracts.ExportSnapshot allDataSnapshot() {
        return new ExportContracts.ExportSnapshot(ExportContracts.ExportScope.ALL_DATA,
                LedgerQueryContracts.EntryTypeFilter.ALL, LedgerQueryContracts.LifecycleFilter.ACTIVE,
                null, null, null, null, null, null, null, null, null, null, null,
                false, false, false, null, null, null, null, "");
    }

    private static long elapsedMillis(long started) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
    }

    private static long elapsedMicros(long started) {
        return TimeUnit.NANOSECONDS.toMicros(System.nanoTime() - started);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }
}
