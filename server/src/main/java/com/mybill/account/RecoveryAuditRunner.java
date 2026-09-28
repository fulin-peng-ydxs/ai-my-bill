package com.mybill.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/** 保全/重放不开放 API；重放只允许专用恢复库且需逐次提供实时数据库指纹。 */
@Component
@Profile("recovery")
final class RecoveryAuditRunner implements ApplicationRunner {
    private final RecoveryAuditMapper mapper;
    private final AccountDeletionService deletion;
    private final AccountDeletionFileRecovery fileRecovery;
    private final ObjectMapper json;
    private final Environment env;
    private final Clock clock;

    RecoveryAuditRunner(RecoveryAuditMapper mapper, AccountDeletionService deletion,
                        AccountDeletionFileRecovery fileRecovery, ObjectMapper json, Environment env, Clock clock) {
        this.mapper = mapper; this.deletion = deletion; this.fileRecovery = fileRecovery; this.json = json; this.env = env; this.clock = clock;
    }

    @Override public void run(ApplicationArguments args) throws Exception {
        String action = env.getRequiredProperty("MY_BILL_RECOVERY_ACTION");
        Path file = Path.of(env.getRequiredProperty("MY_BILL_RECOVERY_AUDIT_FILE"));
        if ("preserve".equals(action)) {
            // CREATE_NEW 拒绝覆盖唯一保全副本；失败文件不应作为完整副本消费。
            try (var writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW)) {
                writer.write("{\"format\":\"my-bill-deletion-audit-v1\"}\n");
                UUID after = new UUID(0, 0);
                long count = 0;
                while (true) {
                    var page = mapper.exportPage(after, clock.instant());
                    if (page.isEmpty()) break;
                    for (String line : page) {
                        writer.write(line); writer.newLine(); count++;
                        after = UUID.fromString(json.readTree(line).get("id").asText());
                    }
                }
                writer.write("{\"complete\":" + count + "}\n");
            }
        } else if ("replay".equals(action)) {
            if (!mapper.databaseName().startsWith("my_bill_restore_")
                    || !mapper.fingerprint().equals(env.getRequiredProperty("MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT"))) {
                throw new IllegalStateException("恢复目标指纹或专用库名不匹配，拒绝写入");
            }
            // 先完整验证边界与结束标记，再逐条幂等重放；文件须来自受控保全并由运维校验归档。
            validate(file);
            // 先收敛上次提交后中断的文件清理；账号已删除时也必须完成补偿。
            fileRecovery.recover();
            try (var reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                reader.readLine();
                for (String line; (line = reader.readLine()) != null;) {
                    var node = json.readTree(line);
                    if (node.has("complete")) break;
                    if (!Instant.parse(node.get("expires_at").asText()).isAfter(clock.instant())) continue;
                    UUID id = UUID.fromString(node.get("id").asText());
                    String digest = node.get("subject_digest").asText();
                    mapper.importAudit(line);
                    if (!digest.equals(mapper.auditDigest(id))) throw new IllegalStateException("恢复审计冲突");
                    for (UUID user : mapper.restoredUsers(digest)) deletion.replayDeletion(user, id);
                }
            }
        } else throw new IllegalArgumentException("只允许 preserve/replay");
    }

    private void validate(Path file) throws Exception {
        if (Files.size(file) > 64 * 1024 * 1024) throw new IllegalArgumentException("审计保全文件超限");
        try (var reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            if (!"my-bill-deletion-audit-v1".equals(json.readTree(reader.readLine()).path("format").asText()))
                throw new IllegalArgumentException("审计文件格式不匹配");
            long count = 0;
            for (String line; (line = reader.readLine()) != null;) {
                if (line.length() > 4096) throw new IllegalArgumentException("审计记录超限");
                var node = json.readTree(line);
                if (node.has("complete")) {
                    if (node.get("complete").asLong(-1) != count || reader.readLine() != null)
                        throw new IllegalArgumentException("审计结束标记无效");
                    return;
                }
                UUID.fromString(node.get("id").asText());
                if (!node.get("subject_digest").asText().matches("[0-9a-f]{64}")
                        || !"SUCCEEDED".equals(node.get("status").asText()))
                    throw new IllegalArgumentException("审计记录无效");
                Instant.parse(node.get("expires_at").asText());
                count++;
            }
            throw new IllegalArgumentException("审计保全不完整");
        }
    }
}
