package com.mybill.ledger;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.nio.file.Path;
import java.time.Duration;

@ConfigurationProperties("my-bill.export")
record ExportProperties(@DefaultValue(".local/exports") Path directory,
                        @DefaultValue("PT24H") Duration retention) {
    ExportProperties {
        if (directory == null) throw new IllegalArgumentException("export directory is required");
        if (retention == null || retention.compareTo(Duration.ofMinutes(5)) < 0
                || retention.compareTo(Duration.ofDays(7)) > 0) {
            throw new IllegalArgumentException("export retention must be between 5 minutes and 7 days");
        }
        directory = directory.toAbsolutePath().normalize();
    }
}
