package com.mybill.shared.persistence;

import org.apache.ibatis.cursor.Cursor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.sql.SQLException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.ToIntFunction;

/**
 * 为领域仓储统一处理 Mapper 参数和结果基数；这里只组合 Mapper 方法，不接受 SQL 文本。
 */
@Component
public final class MybatisOperations {
    public SelectSpec select(Function<Map<String, Object>, List<Map<String, Object>>> mapperMethod) {
        return new SelectSpec(mapperMethod);
    }

    public CursorSpec cursor(Function<Map<String, Object>, Cursor<Map<String, Object>>> mapperMethod) {
        return new CursorSpec(mapperMethod);
    }

    public UpdateSpec update(ToIntFunction<Map<String, Object>> mapperMethod) {
        return new UpdateSpec(mapperMethod);
    }

    public abstract static class Parameters<T extends Parameters<T>> {
        final Map<String, Object> values = new LinkedHashMap<>();
        @SuppressWarnings("unchecked")
        public T param(String name, Object value) { values.put(name, value); return (T) this; }
        Map<String, Object> immutableValues() {
            return Collections.unmodifiableMap(new LinkedHashMap<>(values));
        }
    }

    public static final class UpdateSpec extends Parameters<UpdateSpec> {
        private final ToIntFunction<Map<String, Object>> mapperMethod;
        UpdateSpec(ToIntFunction<Map<String, Object>> mapperMethod) { this.mapperMethod = mapperMethod; }
        public int execute() { return mapperMethod.applyAsInt(immutableValues()); }
    }

    public static final class SelectSpec extends Parameters<SelectSpec> {
        private final Function<Map<String, Object>, List<Map<String, Object>>> mapperMethod;
        SelectSpec(Function<Map<String, Object>, List<Map<String, Object>>> mapperMethod) { this.mapperMethod = mapperMethod; }
        public <T> MappedQuery<T> map(Class<T> type) {
            return new MappedQuery<>(mapperMethod.apply(immutableValues()), row -> convert(firstValue(row), type));
        }
        public <T> MappedQuery<T> map(RowMapper<T> rowMapper) {
            return new MappedQuery<>(mapperMethod.apply(immutableValues()), row -> mapRow(rowMapper, row));
        }
    }

    public static final class CursorSpec extends Parameters<CursorSpec> {
        private final Function<Map<String, Object>, Cursor<Map<String, Object>>> mapperMethod;
        CursorSpec(Function<Map<String, Object>, Cursor<Map<String, Object>>> mapperMethod) { this.mapperMethod = mapperMethod; }
        public void forEach(Consumer<DatabaseRow> consumer) {
            try (Cursor<Map<String, Object>> cursor = mapperMethod.apply(immutableValues())) {
                for (Map<String, Object> row : cursor) consumer.accept(new DatabaseRow(row));
            } catch (IOException failure) {
                throw new IllegalStateException("关闭 MyBatis 游标失败", failure);
            }
        }
    }

    public static final class MappedQuery<T> {
        private final List<Map<String, Object>> rows;
        private final Function<Map<String, Object>, T> mapping;
        MappedQuery(List<Map<String, Object>> rows, Function<Map<String, Object>, T> mapping) {
            this.rows = rows; this.mapping = mapping;
        }
        public List<T> list() { return rows.stream().map(mapping).toList(); }
        public Optional<T> optional() {
            if (rows.size() > 1) throw new IllegalStateException("期望至多一行，实际返回 " + rows.size() + " 行");
            return rows.stream().findFirst().map(mapping);
        }
        public T single() { return optional().orElseThrow(() -> new NoSuchElementException("期望一行，实际未返回数据")); }
    }

    @FunctionalInterface
    public interface RowMapper<T> { T map(DatabaseRow row, int rowNumber) throws SQLException; }

    private static <T> T mapRow(RowMapper<T> mapper, Map<String, Object> row) {
        try { return mapper.map(new DatabaseRow(row), 0); }
        catch (SQLException failure) { throw new IllegalStateException("MyBatis 查询结果映射失败", failure); }
    }
    private static Object firstValue(Map<String, Object> row) { return row.values().stream().findFirst().orElse(null); }
    @SuppressWarnings("unchecked")
    private static <T> T convert(Object value, Class<T> type) {
        if (value == null || type.isInstance(value)) return (T) value;
        if (type == Integer.class && value instanceof Number number) return (T) Integer.valueOf(number.intValue());
        if (type == Long.class && value instanceof Number number) return (T) Long.valueOf(number.longValue());
        if (type == Boolean.class && value instanceof Number number) return (T) Boolean.valueOf(number.intValue() != 0);
        if (type == UUID.class) return (T) UUID.fromString(value.toString());
        if (type == String.class) return (T) value.toString();
        throw new IllegalArgumentException("数据库值无法转换为 " + type.getName());
    }
}
