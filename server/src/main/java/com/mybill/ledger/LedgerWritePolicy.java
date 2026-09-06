package com.mybill.ledger;

import com.mybill.shared.api.ApiException;
import org.springframework.http.HttpStatus;

import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/** 收支写入共用的精度、时间、文本和幂等输入规则。 */
final class LedgerWritePolicy {
    static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    static final Duration IDEMPOTENCY_TTL = Duration.ofHours(24);
    private static final Duration FUTURE_TOLERANCE = Duration.ofMinutes(5);

    private LedgerWritePolicy() { }

    static void validateOccurredAt(Instant occurredAt, Instant now, String label) {
        if (occurredAt != null && occurredAt.isAfter(now.plus(FUTURE_TOLERANCE))) {
            throw fieldError("occurredAt", label + "不能超过服务端当前时间 5 分钟。");
        }
    }

    static String normalizeRequired(String field, String value, int maximum, String label) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty()) throw fieldError(field, label + "不能为空。");
        if (normalized.codePointCount(0, normalized.length()) > maximum) {
            throw fieldError(field, label + "最多 " + maximum + " 个字符。");
        }
        return normalized;
    }

    static String normalizeNote(String value) {
        String note = value == null ? null : value.strip();
        if (note == null || note.isEmpty()) return null;
        if (note.codePointCount(0, note.length()) > 500) throw fieldError("note", "备注最多 500 个字符。");
        return note;
    }

    static String validateIdempotencyKey(String value) {
        String key = value == null ? "" : value.strip();
        if (key.isEmpty() || key.length() > 128) {
            throw fieldError("idempotencyKey", "幂等标识长度必须为 1-128 个字符。");
        }
        return key;
    }

    static BigDecimal decimalField(String field, String value, int scale, BigDecimal maximum, boolean positive) {
        if (value == null || !value.matches("^(0|[1-9]\\d*)(?:\\.\\d+)?$")) {
            throw fieldError(field, "请输入规范的非负十进制数。");
        }
        try {
            BigDecimal decimal = new BigDecimal(value);
            if (decimal.scale() > scale || decimal.compareTo(maximum) > 0
                    || (positive ? decimal.signum() <= 0 : decimal.signum() < 0)) {
                throw fieldError(field, "数值精度或范围无效。");
            }
            return decimal;
        } catch (NumberFormatException exception) {
            throw fieldError(field, "请输入规范的非负十进制数。");
        }
    }

    static String digest(Object... values) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (Object value : values) {
                String canonical = value instanceof BigDecimal decimal ? decimal(decimal) : String.valueOf(value == null ? "<null>" : value);
                byte[] bytes = canonical.getBytes(StandardCharsets.UTF_8);
                digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
                digest.update(bytes);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("运行环境缺少 SHA-256", exception);
        }
    }

    static String decimal(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString();
    }

    static ApiException fieldError(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, false,
                Map.of(field, List.of(message)));
    }
}
