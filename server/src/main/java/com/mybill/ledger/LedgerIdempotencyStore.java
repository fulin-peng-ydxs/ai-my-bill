package com.mybill.ledger;

import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 收支写入共享的租户级幂等记录存储。调用方必须处于租户事务。 */
@Repository
class LedgerIdempotencyStore {
    private final JdbcClient jdbc;

    LedgerIdempotencyStore(JdbcClient jdbc) { this.jdbc = jdbc; }

    Reservation reserve(String operation, String key, String digest, Instant now) {
        jdbc.sql("DELETE FROM idempotency_record WHERE operation=:operation AND idempotency_key=:key AND expires_at<=:now")
                .param("operation", operation).param("key", key).param("now", Timestamp.from(now)).update();
        int inserted = jdbc.sql("""
                INSERT INTO idempotency_record(tenant_id,id,operation,idempotency_key,request_digest,status,expires_at,created_at,updated_at)
                VALUES (current_setting('app.tenant_id')::uuid,:id,:operation,:key,:digest,'IN_PROGRESS',:expiresAt,:now,:now)
                ON CONFLICT (tenant_id,operation,idempotency_key) DO NOTHING
                """).param("id", UUID.randomUUID()).param("operation", operation).param("key", key)
                .param("digest", digest).param("expiresAt", Timestamp.from(now.plus(LedgerWritePolicy.IDEMPOTENCY_TTL)))
                .param("now", Timestamp.from(now)).update();
        if (inserted == 1) return new Reservation(false, null);
        Row row = jdbc.sql("SELECT request_digest,result_reference,status FROM idempotency_record WHERE operation=:operation AND idempotency_key=:key FOR UPDATE")
                .param("operation", operation).param("key", key)
                .query((rs, number) -> new Row(rs.getString(1), rs.getString(2), rs.getString(3))).optional()
                .orElseThrow(() -> new IllegalStateException("幂等键冲突后记录不存在"));
        if (!row.digest().equals(digest)) {
            throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED", "该幂等标识已用于不同内容。", false,
                    Map.of("idempotencyKey", List.of("请为新的填报生成新的幂等标识。")));
        }
        if ("SUCCEEDED".equals(row.status()) && row.resultReference() != null) {
            return new Reservation(true, UUID.fromString(row.resultReference()));
        }
        throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS", "相同填报正在处理中，请稍后重试。", true);
    }

    void complete(String operation, String key, UUID resultId, Instant now) {
        int affected = jdbc.sql("UPDATE idempotency_record SET status='SUCCEEDED',result_reference=:result,updated_at=:now WHERE operation=:operation AND idempotency_key=:key AND status='IN_PROGRESS'")
                .param("result", resultId.toString()).param("now", Timestamp.from(now)).param("operation", operation).param("key", key).update();
        if (affected != 1) throw new IllegalStateException("幂等记录完成写入未命中唯一记录");
    }

    void deleteResult(String operation, UUID resultId) {
        jdbc.sql("DELETE FROM idempotency_record WHERE operation=:operation AND result_reference=:result")
                .param("operation", operation).param("result", resultId.toString()).update();
    }

    record Reservation(boolean replayed, UUID resultId) { }
    private record Row(String digest, String resultReference, String status) { }
}
