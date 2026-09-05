package com.mybill.persistence.config;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;

/**
 * 生产启动门禁：仅用运行角色读取 Flyway 历史，版本不符时 fail-fast，绝不补跑 migration。
 */
@Component
@Order(0)
@ConditionalOnProperty(prefix = "my-bill.schema", name = "validation-enabled", havingValue = "true")
@EnableConfigurationProperties(SchemaVersionProperties.class)
public class SchemaVersionGuard implements ApplicationRunner {

    private final JdbcClient jdbcClient;
    private final SchemaVersionProperties properties;

    public SchemaVersionGuard(JdbcClient jdbcClient, SchemaVersionProperties properties) {
        this.jdbcClient = jdbcClient;
        this.properties = properties;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!properties.validationEnabled()) {
            return;
        }
        String actualVersion = jdbcClient.sql("""
                        SELECT version
                          FROM flyway_schema_history
                         WHERE success = true AND version IS NOT NULL
                         ORDER BY installed_rank DESC
                         LIMIT 1
                        """)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new IllegalStateException("数据库尚未完成版本化迁移"));
        if (!properties.expectedVersion().equals(actualVersion)) {
            throw new IllegalStateException(
                    "数据库 schema 版本不匹配：期望 " + properties.expectedVersion() + "，实际 " + actualVersion);
        }
    }
}
