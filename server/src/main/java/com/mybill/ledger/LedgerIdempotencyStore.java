package com.mybill.ledger;

import com.mybill.shared.api.ApiException;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.http.HttpStatus;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 收支写入共享的租户级幂等记录存储。调用方必须处于租户事务。 */
@Repository
class LedgerIdempotencyStore {
    private final MybatisOperations operations;
    private final LedgerIdempotencyStoreMapper mapper;
    private final MeterRegistry meters;

    LedgerIdempotencyStore(MybatisOperations operations, LedgerIdempotencyStoreMapper mapper, MeterRegistry meters) {
        this.operations = operations;
        this.mapper = mapper;
        this.meters = meters;
    }

    Reservation reserve(String operation, String key, String digest, Instant now) {
        operations.update(mapper::reserve)
                .param("operation", operation).param("key", key).param("now", Timestamp.from(now)).execute();
        int inserted = operations.update(mapper::insertReservation).param("id", UUID.randomUUID()).param("operation", operation).param("key", key)
                .param("digest", digest).param("expiresAt", Timestamp.from(now.plus(LedgerWritePolicy.IDEMPOTENCY_TTL)))
                .param("now", Timestamp.from(now)).execute();
        if (inserted == 1) {
            meters.counter("my_bill.idempotency.reservations", "operation", operation, "outcome", "created").increment();
            return new Reservation(false, null);
        }
        Row row = operations.select(mapper::lockReservation)
                .param("operation", operation).param("key", key)
                .map((rs, number) -> new Row(rs.getString("request_digest"), rs.getString("result_reference"),
                        rs.getString("status"))).optional()
                .orElseThrow(() -> new IllegalStateException("幂等键冲突后记录不存在"));
        if (!row.digest().equals(digest)) {
            meters.counter("my_bill.idempotency.reservations", "operation", operation, "outcome", "reused").increment();
            throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED", "该幂等标识已用于不同内容。", false,
                    Map.of("idempotencyKey", List.of("请为新的填报生成新的幂等标识。")));
        }
        if ("SUCCEEDED".equals(row.status()) && row.resultReference() != null) {
            meters.counter("my_bill.idempotency.reservations", "operation", operation, "outcome", "replayed").increment();
            return new Reservation(true, UUID.fromString(row.resultReference()));
        }
        meters.counter("my_bill.idempotency.reservations", "operation", operation, "outcome", "in_progress").increment();
        throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_IN_PROGRESS", "相同填报正在处理中，请稍后重试。", true);
    }

    void complete(String operation, String key, UUID resultId, Instant now) {
        int affected = operations.update(mapper::complete)
                .param("result", resultId.toString()).param("now", Timestamp.from(now)).param("operation", operation).param("key", key).execute();
        if (affected != 1) throw new IllegalStateException("幂等记录完成写入未命中唯一记录");
    }

    void deleteResult(String operation, UUID resultId) {
        operations.update(mapper::deleteResult)
                .param("operation", operation).param("result", resultId.toString()).execute();
    }

    record Reservation(boolean replayed, UUID resultId) { }
    private record Row(String digest, String resultReference, String status) { }
}
