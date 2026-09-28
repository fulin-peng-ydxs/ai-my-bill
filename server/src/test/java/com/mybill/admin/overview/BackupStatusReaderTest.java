package com.mybill.admin.overview;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import static org.junit.jupiter.api.Assertions.*;
import static com.mybill.admin.overview.AdminOverviewContracts.BackupStatus;

class BackupStatusReaderTest {
    @TempDir Path directory;
    final Clock clock = Clock.fixed(Instant.parse("2026-09-28T12:00:00Z"), ZoneOffset.UTC);

    @Test void unconfiguredMissingAndMalformedNeverClaimSuccess() throws Exception {
        assertEquals(BackupStatus.UNCONFIGURED, new BackupStatusReader("", clock).read().status());
        Path file = directory.resolve("backup.properties");
        BackupStatusReader reader = new BackupStatusReader(file.toString(), clock);
        assertEquals(BackupStatus.UNAVAILABLE, reader.read().status());
        for (String value : new String[]{"password=secret", "x".repeat(4097),
                "status=SUCCEEDED\nattemptedAt=2026-09-28T12:00:00Z", 
                "status=SUCCEEDED\nattemptedAt=2027-01-01T00:00:00Z\nlatestCompletedAt=2027-01-01T00:00:00Z"}) {
            Files.writeString(file, value);
            assertEquals(BackupStatus.UNAVAILABLE, reader.read().status());
            assertNull(reader.read().latestCompletedAt());
        }
    }

    @Test void latestFailureOverridesPriorSuccessAndStaleSuccessIsNotHealthy() throws Exception {
        assertEquals(BackupStatus.SUCCEEDED, read("SUCCEEDED", "2026-09-28T11:00:00Z", "2026-09-28T11:00:00Z"));
        assertEquals(BackupStatus.FAILED, read("FAILED", "2026-09-28T11:00:00Z", "2026-09-27T11:00:00Z"));
        assertEquals(BackupStatus.STALE, read("SUCCEEDED", "2026-09-27T09:00:00Z", "2026-09-27T09:00:00Z"));
        assertEquals(BackupStatus.RUNNING, read("RUNNING", "2026-09-28T11:59:00Z", ""));
        assertEquals(BackupStatus.STALE, read("RUNNING", "2026-09-28T10:00:00Z", ""));
    }

    private BackupStatus read(String status, String attempt, String latest) throws Exception {
        Path file = directory.resolve("backup.properties");
        Files.writeString(file, "status=" + status + "\nattemptedAt=" + attempt + "\nlatestCompletedAt=" + latest);
        return new BackupStatusReader(file.toString(), clock).read().status();
    }
}
