package com.mybill.job;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;

/** 启动时只收敛已过期租约；不会偷偷启用周期调度。 */
@Component
@Order(100)
@EnableConfigurationProperties(JobRunnerProperties.class)
final class JobStartupRecovery implements ApplicationRunner {
    private final JobCoordinator coordinator;
    private final org.springframework.core.env.Environment environment;

    JobStartupRecovery(JobCoordinator coordinator, org.springframework.core.env.Environment environment) { this.coordinator = coordinator;
        this.environment = environment; }

    @Override public void run(ApplicationArguments args) {
        if (!environment.acceptsProfiles(org.springframework.core.env.Profiles.of("recovery"))) coordinator.recoverExpired();
    }
}
