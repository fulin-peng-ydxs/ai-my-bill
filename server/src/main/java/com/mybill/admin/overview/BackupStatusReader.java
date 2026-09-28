package com.mybill.admin.overview;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Properties;

import static com.mybill.admin.overview.AdminOverviewContracts.BackupOverview;
import static com.mybill.admin.overview.AdminOverviewContracts.BackupStatus;

/** 只读取宿主原子发布的非敏感状态，不访问备份、密钥或 Docker；损坏和过期状态不得显示成功。 */
@Component
final class BackupStatusReader {
    private final String file;
    private final Clock clock;

    BackupStatusReader(@Value("${my-bill.backup.status-file:}") String file, Clock clock) {
        this.file = file;
        this.clock = clock;
    }

    BackupOverview read() {
        if (file.isBlank()) return new BackupOverview(BackupStatus.UNCONFIGURED, null);
        try (var input = Files.newInputStream(Path.of(file))) {
            byte[] bytes = input.readNBytes(4097);
            if (bytes.length > 4096) throw new IllegalArgumentException("status too large");
            Properties values = new Properties();
            values.load(new StringReader(new String(bytes, StandardCharsets.UTF_8)));
            BackupStatus status = BackupStatus.valueOf(values.getProperty("status"));
            if (status != BackupStatus.SUCCEEDED && status != BackupStatus.FAILED && status != BackupStatus.RUNNING) {
                throw new IllegalArgumentException("invalid producer status");
            }
            Instant attempt = Instant.parse(values.getProperty("attemptedAt"));
            String completed = values.getProperty("latestCompletedAt", "");
            Instant latest = completed.isBlank() ? null : Instant.parse(completed);
            Instant now = clock.instant();
            if (attempt.isAfter(now.plusSeconds(300)) || (latest != null && latest.isAfter(attempt))) {
                throw new IllegalArgumentException("invalid timestamps");
            }
            if (status == BackupStatus.SUCCEEDED && latest == null) throw new IllegalArgumentException("missing success");
            if (status == BackupStatus.SUCCEEDED && latest.isBefore(now.minus(Duration.ofHours(26)))
                    || status == BackupStatus.RUNNING && attempt.isBefore(now.minus(Duration.ofHours(1)))) {
                status = BackupStatus.STALE;
            }
            return new BackupOverview(status, latest);
        } catch (Exception invalidOrUnavailable) {
            // 不向 API 或日志泄露文件路径与原始状态内容。
            return new BackupOverview(BackupStatus.UNAVAILABLE, null);
        }
    }
}
