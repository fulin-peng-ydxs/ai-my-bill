package com.mybill.persistence;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 无容器运行时也必须验证的部署静态边界；真实镜像启动仍由具备 Docker 的 CI/发布环境执行。
 */
class DeploymentBoundaryTest {

    private static final Path PROJECT_ROOT = Path.of("..").toAbsolutePath().normalize();

    @Test
    void longRunningServicesCannotSeeMigrationCredentials() throws IOException {
        String compose = read("deploy/compose.yaml");
        String db = section(compose, "  db:", "  provision:");
        String provision = section(compose, "  provision:", "  migrate:");
        String migrate = section(compose, "  migrate:", "  app:");
        String app = section(compose, "  app:", "networks:");

        assertThat(db).contains("postgres_admin_password").doesNotContain("migration_db_password", "app_db_password");
        assertThat(provision).contains("restart: \"no\"", "postgres_admin_password", "migration_db_password", "app_db_password");
        assertThat(migrate).contains("restart: \"no\"", "migration_db_password")
                .doesNotContain("app_db_password", "postgres_admin_password");
        assertThat(app).contains("app_db_password").doesNotContain("migration_db_password", "postgres_admin_password");
    }

    @Test
    void migrationImageContainsNoBusinessRuntimeAndProductionDisablesEmbeddedFlyway() throws IOException {
        String dockerfile = read("server/Dockerfile");
        String migrateStage = dockerfile.substring(dockerfile.indexOf("FROM flyway/flyway"));

        assertThat(migrateStage).contains("server/src/main/resources/db/migration", "USER 10001:10001")
                .doesNotContain("my-bill-server.jar", "run-app.sh", "spring-boot");
        assertThat(read("server/src/main/resources/application-prod.yml"))
                .contains("flyway:", "enabled: false", "validation-enabled: true", "expected-version: \"007\"");
        assertThat(read("deploy/scripts/run-app.sh"))
                .contains("禁止出现 MY_BILL_MIGRATION_DB_*", "MY_BILL_APP_DB_PASSWORD_FILE")
                .doesNotContain("migration_db_password");
    }

    @Test
    void entrypointsRejectEmptySecretsAndAnyMigrationEnvironmentInTheApplication() throws Exception {
        Path emptySecret = Files.createTempFile("my-bill-empty-secret", ".txt");
        Path appSecret = Files.createTempFile("my-bill-app-secret", ".txt");
        try {
            Files.writeString(appSecret, "test-only-password");
            ScriptResult emptyApp = runScript("deploy/scripts/run-app.sh", Map.of(
                    "MY_BILL_APP_DB_URL", "jdbc:postgresql://invalid/my_bill",
                    "MY_BILL_APP_DB_USERNAME", "my_bill_app",
                    "MY_BILL_APP_DB_PASSWORD_FILE", emptySecret.toString()));
            assertThat(emptyApp.exitCode()).isNotZero();
            assertThat(emptyApp.output()).contains("应用数据库密码 secret 不能为空");

            ScriptResult emptyMigration = runScript("deploy/scripts/run-flyway.sh", Map.of(
                    "MY_BILL_MIGRATION_DB_URL", "jdbc:postgresql://invalid/my_bill",
                    "MY_BILL_MIGRATION_DB_USERNAME", "my_bill_migration",
                    "MY_BILL_MIGRATION_DB_PASSWORD_FILE", emptySecret.toString()));
            assertThat(emptyMigration.exitCode()).isNotZero();
            assertThat(emptyMigration.output()).contains("迁移密码 secret 不能为空");

            ScriptResult leakedMigrationVariable = runScript("deploy/scripts/run-app.sh", Map.of(
                    "MY_BILL_APP_DB_URL", "jdbc:postgresql://invalid/my_bill",
                    "MY_BILL_APP_DB_USERNAME", "my_bill_app",
                    "MY_BILL_APP_DB_PASSWORD_FILE", appSecret.toString(),
                    "MY_BILL_MIGRATION_DB_UNEXPECTED", "must-be-rejected"));
            assertThat(leakedMigrationVariable.exitCode()).isNotZero();
            assertThat(leakedMigrationVariable.output()).contains("禁止出现 MY_BILL_MIGRATION_DB_*");
        } finally {
            Files.deleteIfExists(emptySecret);
            Files.deleteIfExists(appSecret);
        }
    }

    private static String read(String relativePath) throws IOException {
        return Files.readString(PROJECT_ROOT.resolve(relativePath));
    }

    private static String section(String source, String start, String end) {
        int startIndex = source.indexOf(start);
        int endIndex = source.indexOf(end, startIndex + start.length());
        if (startIndex < 0 || endIndex < 0) {
            throw new IllegalArgumentException("missing compose section " + start + " -> " + end);
        }
        return source.substring(startIndex, endIndex);
    }

    private static ScriptResult runScript(String path, Map<String, String> environment) throws Exception {
        ProcessBuilder builder = new ProcessBuilder("bash", PROJECT_ROOT.resolve(path).toString())
                .redirectErrorStream(true);
        builder.environment().keySet().removeIf(name -> name.startsWith("MY_BILL_MIGRATION_DB_"));
        builder.environment().putAll(environment);
        Process process = builder.start();
        if (!process.waitFor(5, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("部署入口脚本未在预期时间内退出：" + path);
        }
        return new ScriptResult(process.exitValue(),
                new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
    }

    private record ScriptResult(int exitCode, String output) { }
}
