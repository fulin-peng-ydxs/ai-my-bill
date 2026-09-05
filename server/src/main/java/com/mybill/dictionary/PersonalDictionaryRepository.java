package com.mybill.dictionary;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 在已设置 RLS 上下文的事务内访问枚举白名单中的个人字典表。 */
@Repository
class PersonalDictionaryRepository {
    private final JdbcClient jdbc;

    PersonalDictionaryRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<DictionaryRow> list(DictionaryType type, String query, DictionaryStatus status, int limit, int offset,
                             boolean candidatesOnly) {
        String parentJoin = type.hierarchical()
                ? "LEFT JOIN expense_category p ON p.tenant_id = d.tenant_id AND p.id = d.parent_id" : "";
        String parentName = type.hierarchical() ? "p.display_name" : "NULL::varchar";
        String mergedFilter = type == DictionaryType.PRODUCT ? "AND d.status <> 'MERGED'" : "";
        String activeFilter = candidatesOnly ? "AND d.status = 'ACTIVE'" : "";
        String activeParentFilter = candidatesOnly && type.hierarchical()
                ? "AND (d.parent_id IS NULL OR p.status = 'ACTIVE')" : "";
        String orderBy = type.hierarchical()
                ? "COALESCE(p.sort_order, d.sort_order), COALESCE(p.created_at, d.created_at), "
                    + "COALESCE(p.id, d.id), CASE WHEN d.parent_id IS NULL THEN 0 ELSE 1 END, "
                    + "d.sort_order, d.created_at, d.id"
                : "d.sort_order, d.created_at, d.id";
        return jdbc.sql("""
                        SELECT d.id, d.display_name, d.sort_order, d.status,
                               %s AS parent_name, %s AS referenced%s
                        FROM %s d %s
                        WHERE (:query = '' OR lower(d.display_name) LIKE ('%%' || lower(:query) || '%%') ESCAPE '\\')
                          AND (CAST(:status AS varchar) IS NULL OR d.status = CAST(:status AS varchar))
                          %s %s %s
                        ORDER BY %s
                        LIMIT :limit OFFSET :offset
                        """.formatted(parentName, type.referenceExpression(),
                        type.hierarchical() ? ", d.parent_id" : ", NULL::uuid AS parent_id",
                        type.table(), parentJoin, mergedFilter, activeFilter, activeParentFilter, orderBy))
                .param("query", query).param("status", status == null ? null : status.name())
                .param("limit", limit).param("offset", offset)
                .query(PersonalDictionaryRepository::mapRow).list();
    }

    long count(DictionaryType type, String query, DictionaryStatus status, boolean candidatesOnly) {
        String parentJoin = type.hierarchical()
                ? "LEFT JOIN expense_category p ON p.tenant_id = d.tenant_id AND p.id = d.parent_id" : "";
        String mergedFilter = type == DictionaryType.PRODUCT ? "AND d.status <> 'MERGED'" : "";
        String activeFilter = candidatesOnly ? "AND d.status = 'ACTIVE'" : "";
        String activeParentFilter = candidatesOnly && type.hierarchical()
                ? "AND (d.parent_id IS NULL OR p.status = 'ACTIVE')" : "";
        return jdbc.sql("""
                        SELECT count(*) FROM %s d %s
                        WHERE (:query = '' OR lower(d.display_name) LIKE ('%%' || lower(:query) || '%%') ESCAPE '\\')
                          AND (CAST(:status AS varchar) IS NULL OR d.status = CAST(:status AS varchar))
                          %s %s %s
                        """.formatted(type.table(), parentJoin, mergedFilter, activeFilter, activeParentFilter))
                .param("query", query).param("status", status == null ? null : status.name())
                .query(Long.class).single();
    }

    List<CountRow> countAll() {
        return java.util.Arrays.stream(DictionaryType.values()).map(type -> {
            String mergedFilter = type == DictionaryType.PRODUCT ? " WHERE status <> 'MERGED'" : "";
            return jdbc.sql("SELECT count(*), count(*) FILTER (WHERE status = 'ACTIVE') FROM "
                            + type.table() + mergedFilter)
                    .query((rs, row) -> new CountRow(type, rs.getLong(1), rs.getLong(2))).single();
        }).toList();
    }

    Optional<DictionaryRow> findForUpdate(DictionaryType type, UUID id) {
        return find(type, id, true);
    }

    Optional<DictionaryRow> find(DictionaryType type, UUID id) {
        return find(type, id, false);
    }

    private Optional<DictionaryRow> find(DictionaryType type, UUID id, boolean forUpdate) {
        String parentJoin = type.hierarchical()
                ? "LEFT JOIN expense_category p ON p.tenant_id = d.tenant_id AND p.id = d.parent_id" : "";
        String parentName = type.hierarchical() ? "p.display_name" : "NULL::varchar";
        String mergedFilter = type == DictionaryType.PRODUCT ? " AND d.status <> 'MERGED'" : "";
        String lock = forUpdate ? " FOR UPDATE OF d" : "";
        return jdbc.sql("""
                        SELECT d.id, d.display_name, d.sort_order, d.status,
                               %s AS parent_name, %s AS referenced%s
                        FROM %s d %s WHERE d.id = :id %s%s
                        """.formatted(parentName, type.referenceExpression(),
                        type.hierarchical() ? ", d.parent_id" : ", NULL::uuid AS parent_id",
                        type.table(), parentJoin, mergedFilter, lock))
                .param("id", id).query(PersonalDictionaryRepository::mapRow).optional();
    }

    int maxSortOrder(DictionaryType type, UUID parentId) {
        String parentFilter = type.hierarchical()
                ? "AND parent_id IS NOT DISTINCT FROM :parentId" : "";
        JdbcClient.StatementSpec statement = jdbc.sql("SELECT COALESCE(max(sort_order), -10) FROM "
                + type.table() + " WHERE true " + parentFilter);
        if (type.hierarchical()) statement = statement.param("parentId", parentId);
        return statement.query(Integer.class).single();
    }

    void insert(DictionaryType type, UUID id, String displayName, String normalizedName,
                int sortOrder, UUID parentId, Instant now) {
        String parentColumn = type.hierarchical() ? ", parent_id" : "";
        String parentValue = type.hierarchical() ? ", :parentId" : "";
        JdbcClient.StatementSpec statement = jdbc.sql("INSERT INTO " + type.table()
                + "(id, tenant_id, display_name, normalized_name, sort_order, status, created_at, updated_at"
                + parentColumn + ") VALUES (:id, current_setting('app.tenant_id')::uuid, :name, :normalized, :sortOrder, "
                + "'ACTIVE', :now, :now" + parentValue + ")")
                .param("id", id).param("name", displayName).param("normalized", normalizedName)
                .param("sortOrder", sortOrder).param("now", Timestamp.from(now));
        if (type.hierarchical()) statement = statement.param("parentId", parentId);
        statement.update();
    }

    int rename(DictionaryType type, UUID id, String displayName, String normalizedName, Instant now) {
        return jdbc.sql("UPDATE " + type.table()
                        + " SET display_name = :name, normalized_name = :normalized, updated_at = :now WHERE id = :id")
                .param("name", displayName).param("normalized", normalizedName)
                .param("now", Timestamp.from(now)).param("id", id).update();
    }

    int updateStatus(DictionaryType type, UUID id, DictionaryStatus status, Instant now) {
        return jdbc.sql("UPDATE " + type.table() + " SET status = :status, updated_at = :now WHERE id = :id")
                .param("status", status.name()).param("now", Timestamp.from(now)).param("id", id).update();
    }

    long activeChildren(UUID parentId) {
        return jdbc.sql("SELECT count(*) FROM expense_category WHERE parent_id = :id AND status = 'ACTIVE'")
                .param("id", parentId).query(Long.class).single();
    }

    List<UUID> lockSiblingIds(DictionaryType type, UUID parentId) {
        String parentFilter = type.hierarchical()
                ? "WHERE parent_id IS NOT DISTINCT FROM :parentId" : "";
        JdbcClient.StatementSpec statement = jdbc.sql("SELECT id FROM " + type.table() + " " + parentFilter
                + (type == DictionaryType.PRODUCT ? (parentFilter.isEmpty() ? " WHERE" : " AND")
                + " status <> 'MERGED'" : "")
                + " ORDER BY sort_order, created_at, id FOR UPDATE");
        if (type.hierarchical()) statement = statement.param("parentId", parentId);
        return statement.query(UUID.class).list();
    }

    void updateSortOrder(DictionaryType type, UUID id, int sortOrder, Instant now) {
        int affected = jdbc.sql("UPDATE " + type.table() + " SET sort_order = :sortOrder, updated_at = :now WHERE id = :id")
                .param("sortOrder", sortOrder).param("now", Timestamp.from(now)).param("id", id).update();
        if (affected != 1) throw new IllegalStateException("字典排序写入未命中唯一记录");
    }

    private static DictionaryRow mapRow(ResultSet rs, int rowNumber) throws SQLException {
        return new DictionaryRow(rs.getObject("id", UUID.class), rs.getString("display_name"),
                rs.getInt("sort_order"), DictionaryStatus.valueOf(rs.getString("status")),
                rs.getObject("parent_id", UUID.class), rs.getString("parent_name"), rs.getBoolean("referenced"));
    }

    record DictionaryRow(UUID id, String displayName, int sortOrder, DictionaryStatus status,
                         UUID parentId, String parentName, boolean referenced) { }
    record CountRow(DictionaryType type, long total, long active) { }
}
