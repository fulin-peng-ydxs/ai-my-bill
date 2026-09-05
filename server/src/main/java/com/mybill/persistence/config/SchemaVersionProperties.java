package com.mybill.persistence.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 常驻应用只读核对的数据库版本合同；生产环境不得借此触发迁移。
 */
@ConfigurationProperties(prefix = "my-bill.schema")
public record SchemaVersionProperties(boolean validationEnabled, String expectedVersion) {
}
