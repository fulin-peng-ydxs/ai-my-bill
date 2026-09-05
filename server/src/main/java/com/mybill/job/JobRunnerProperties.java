package com.mybill.job;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

@ConfigurationProperties("my-bill.jobs")
public record JobRunnerProperties(@DefaultValue("PT30S") Duration leaseDuration) {
    public JobRunnerProperties {
        if (leaseDuration == null || leaseDuration.compareTo(Duration.ofSeconds(5)) < 0
                || leaseDuration.compareTo(Duration.ofMinutes(10)) > 0) {
            throw new IllegalArgumentException("job lease duration must be between 5 seconds and 10 minutes");
        }
    }
}
