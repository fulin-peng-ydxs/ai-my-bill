package com.mybill.shared.logging;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.logging.LoggingInitializationContext;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import static org.assertj.core.api.Assertions.assertThat;

class LoggingConfigurationTest {
    @Test
    void productionJsonAndLocalFileAreWiredThroughActualLogbackConfig() throws Exception {
        Path directory = Files.createTempDirectory("my-bill-logback-");
        try {
            for (String profile : new String[]{"prod", "local-logging"}) {
                Process child = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                        "-cp", System.getProperty("java.class.path"), Probe.class.getName(), profile,
                        directory.resolve("application.log").toString()).redirectErrorStream(true).start();
                String output = new String(child.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                assertThat(child.waitFor()).as(output).isZero();
                assertThat(output).contains("privacy_marker").doesNotContain("secret-content", "ERROR in");
                if (profile.equals("prod")) {
                    String event = output.lines().filter(line -> line.startsWith("{") && line.contains("privacy_marker")).findFirst().orElseThrow();
                    var json = new com.fasterxml.jackson.databind.ObjectMapper().readTree(event);
                    assertThat(json.path("traceId").asText()).isEqualTo("test-trace");
                    assertThat(Files.exists(directory.resolve("application.log"))).isFalse();
                } else {
                    assertThat(Files.readString(directory.resolve("application.log"))).contains("privacy_marker", "test-trace")
                            .doesNotContain("secret-content");
                }
            }
        } finally {
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }

    public static class Probe {
        public static void main(String[] args) {
            StandardEnvironment environment = new StandardEnvironment();
            environment.setActiveProfiles(args[0]);
            environment.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                    "logging.structured.format.console", args[0].equals("prod") ? "ecs" : "",
                    "logging.structured.json.stacktrace.printer", SafeStackTracePrinter.class.getName(),
                    "logging.structured.json.exclude", "error.message",
                    "logging.file.name", args[1], "logging.pattern.level", "%5p traceId=%X{traceId:-}")));
            LoggingSystem system = LoggingSystem.get(Probe.class.getClassLoader());
            system.beforeInitialize();
            system.initialize(new LoggingInitializationContext(environment), "classpath:logback-spring.xml",
                    org.springframework.boot.logging.LogFile.get(environment));
            org.slf4j.MDC.put("traceId", "test-trace");
            org.slf4j.LoggerFactory.getLogger(Probe.class).error("privacy_marker", new RuntimeException("secret-content"));
            system.cleanUp();
            ((ch.qos.logback.classic.LoggerContext) org.slf4j.LoggerFactory.getILoggerFactory()).stop();
        }
    }
}
