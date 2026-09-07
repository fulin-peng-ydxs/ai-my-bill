package com.mybill.architecture;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** 防止 SQL 重新散落到生产 Java；SQL 的唯一事实位置是 mapper XML。 */
class PersistenceSourceBoundaryTest {
    @Test
    void productionJavaContainsNeitherSqlExecutionApisNorSqlTextBlocks() throws IOException {
        Path sourceRoot = Path.of("src/main/java");
        try (var files = Files.walk(sourceRoot)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file);
                assertThat(source)
                        .as("production persistence boundary in %s", file)
                        .doesNotContain(
                                "JdbcClient", "JdbcTemplate", ".sql(",
                                "org.apache.ibatis.annotations.Select",
                                "org.apache.ibatis.annotations.Insert",
                                "org.apache.ibatis.annotations.Update",
                                "org.apache.ibatis.annotations.Delete")
                        .doesNotMatch("(?is).*\"\"\"\\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\\b.*");
            }
        }
    }
}
