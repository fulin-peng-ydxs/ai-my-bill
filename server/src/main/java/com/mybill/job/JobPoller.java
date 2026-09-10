package com.mybill.job;

import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 轻量任务轮询器；多实例由数据库 SKIP LOCKED 与租约保证同一任务只被一个实例执行。 */
@Component
@EnableScheduling
final class JobPoller {
    private final JobCoordinator coordinator;
    private final JobRunnerProperties properties;

    JobPoller(JobCoordinator coordinator, JobRunnerProperties properties) {
        this.coordinator = coordinator;
        this.properties = properties;
    }

    @Scheduled(initialDelayString = "${my-bill.jobs.poll-delay-ms:5000}",
            fixedDelayString = "${my-bill.jobs.poll-delay-ms:5000}")
    void poll() { coordinator.runAvailable(properties.maxTasksPerPoll()); }
}
