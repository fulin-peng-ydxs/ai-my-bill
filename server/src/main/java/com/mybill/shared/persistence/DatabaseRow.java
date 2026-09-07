package com.mybill.shared.persistence;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** 对 MyBatis Map 结果提供统一的强类型列读取，避免领域仓储依赖 JDBC DatabaseRow。 */
public final class DatabaseRow {
    private final Map<String, Object> values;

    public DatabaseRow(Map<String, Object> values) { this.values = values; }

    public String getString(String column) { Object value = value(column); return value == null ? null : value.toString(); }
    public BigDecimal getBigDecimal(String column) {
        Object value = value(column);
        return value == null || value instanceof BigDecimal ? (BigDecimal) value : new BigDecimal(value.toString());
    }
    public Timestamp getTimestamp(String column) {
        Object value = value(column);
        if (value == null || value instanceof Timestamp) return (Timestamp) value;
        if (value instanceof OffsetDateTime dateTime) return Timestamp.from(dateTime.toInstant());
        throw incompatible(column, value, Timestamp.class);
    }
    public boolean getBoolean(String column) {
        Object value = value(column);
        if (value instanceof Boolean bool) return bool;
        if (value instanceof Number number) return number.intValue() != 0;
        return Boolean.parseBoolean(String.valueOf(value));
    }
    public int getInt(String column) { Object value = value(column); return value == null ? 0 : ((Number) value).intValue(); }
    public long getLong(String column) { Object value = value(column); return value == null ? 0 : ((Number) value).longValue(); }
    public Object getObject(String column) { return value(column); }
    public <T> T getObject(String column, Class<T> type) {
        Object value = value(column);
        if (value == null) return null;
        if (type.isInstance(value)) return type.cast(value);
        if (type == UUID.class) return type.cast(UUID.fromString(value.toString()));
        if (type == LocalDate.class && value instanceof java.sql.Date date) return type.cast(date.toLocalDate());
        if (type == OffsetDateTime.class && value instanceof Timestamp timestamp) {
            return type.cast(timestamp.toInstant().atOffset(ZoneOffset.UTC));
        }
        throw incompatible(column, value, type);
    }
    public boolean isNull(String column) { return value(column) == null; }

    private Object value(String column) {
        Object direct = values.get(column);
        if (direct != null || values.containsKey(column)) return direct;
        String lower = column.toLowerCase(Locale.ROOT);
        return values.entrySet().stream().filter(entry -> entry.getKey().toLowerCase(Locale.ROOT).equals(lower))
                .map(Map.Entry::getValue).findFirst().orElse(null);
    }
    private static IllegalArgumentException incompatible(String column, Object value, Class<?> target) {
        return new IllegalArgumentException("数据库列 " + column + " 的类型 " + value.getClass().getName()
                + " 无法转换为 " + target.getName());
    }
}
