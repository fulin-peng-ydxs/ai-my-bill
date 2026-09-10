package com.mybill.ledger;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

class LedgerLifecycleScheduleTest {
    @Test
    void sharesOneMinuteBucketWithoutSchedulingBeforeExpiry() {
        LedgerLifecycleService.PurgeSchedule first = LedgerLifecycleService.purgeSchedule(
                Instant.parse("2026-09-10T12:34:00.001Z"));
        LedgerLifecycleService.PurgeSchedule second = LedgerLifecycleService.purgeSchedule(
                Instant.parse("2026-09-10T12:34:59.999Z"));

        assertThat(first).isEqualTo(second);
        assertThat(first.availableAt()).isEqualTo(Instant.parse("2026-09-10T12:35:00Z"));
        assertThat(first.batchKey()).isEqualTo("purge-minute:29817395");
    }

    @Test
    void keepsAnExactMinuteExpiryAtThatMinute() {
        LedgerLifecycleService.PurgeSchedule schedule = LedgerLifecycleService.purgeSchedule(
                Instant.parse("2026-09-10T12:34:00Z"));

        assertThat(schedule.availableAt()).isEqualTo(Instant.parse("2026-09-10T12:34:00Z"));
    }

    @Test
    void oneThousandExpiriesWithinTheSameMinuteShareOneTaskBucket() {
        Instant minute = Instant.parse("2026-09-10T12:34:00Z");

        long distinctSchedules = IntStream.rangeClosed(1, 1_000)
                .mapToObj(offset -> LedgerLifecycleService.purgeSchedule(minute.plusMillis(offset)))
                .distinct()
                .count();

        assertThat(distinctSchedules).isOne();
    }
}
