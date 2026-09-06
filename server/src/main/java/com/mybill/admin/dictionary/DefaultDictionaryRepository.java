package com.mybill.admin.dictionary;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 默认字典只访问系统级默认表，不读取任何租户个人字典或账目。 */
@Repository
class DefaultDictionaryRepository {
    private static final long CATALOG_LOCK = 7_204_918_330_117L;
    private final JdbcClient jdbc;

    DefaultDictionaryRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void lockCatalog() {
        jdbc.sql("SELECT pg_advisory_xact_lock(:lockId)").param("lockId", CATALOG_LOCK)
                .query((rs, row) -> true).single();
    }

    List<CountRow> countAll() {
        return Arrays.stream(DefaultDictionaryType.values()).map(type -> jdbc.sql("""
                        SELECT count(*), count(*) FILTER (WHERE status = 'ACTIVE')
                        FROM default_dictionary_item WHERE dictionary_type = :type
                        """).param("type", type.name())
                .query((rs, row) -> new CountRow(type, rs.getLong(1), rs.getLong(2))).single()).toList();
    }

    List<DefaultRow> list(DefaultDictionaryType type, String query, DefaultDictionaryStatus status,
                          int limit, int offset) {
        return jdbc.sql("""
                        SELECT d.id, d.display_name, d.sort_order, d.status, d.parent_id, p.display_name AS parent_name
                        FROM default_dictionary_item d
                        LEFT JOIN default_dictionary_item p
                          ON p.dictionary_type = d.dictionary_type AND p.id = d.parent_id
                        WHERE d.dictionary_type = :type
                          AND (:query = '' OR lower(d.display_name) LIKE ('%%' || lower(:query) || '%%') ESCAPE '\\')
                          AND (CAST(:status AS varchar) IS NULL OR d.status = CAST(:status AS varchar))
                        ORDER BY COALESCE(p.sort_order, d.sort_order), COALESCE(p.created_at, d.created_at),
                                 COALESCE(p.id, d.id), CASE WHEN d.parent_id IS NULL THEN 0 ELSE 1 END,
                                 d.sort_order, d.created_at, d.id
                        LIMIT :limit OFFSET :offset
                        """)
                .param("type", type.name()).param("query", query)
                .param("status", status == null ? null : status.name())
                .param("limit", limit).param("offset", offset)
                .query(DefaultDictionaryRepository::mapRow).list();
    }

    long count(DefaultDictionaryType type, String query, DefaultDictionaryStatus status) {
        return jdbc.sql("""
                        SELECT count(*) FROM default_dictionary_item
                        WHERE dictionary_type = :type
                          AND (:query = '' OR lower(display_name) LIKE ('%%' || lower(:query) || '%%') ESCAPE '\\')
                          AND (CAST(:status AS varchar) IS NULL OR status = CAST(:status AS varchar))
                        """)
                .param("type", type.name()).param("query", query)
                .param("status", status == null ? null : status.name())
                .query(Long.class).single();
    }

    Optional<DefaultRow> find(DefaultDictionaryType type, UUID id, boolean forUpdate) {
        return jdbc.sql("""
                        SELECT d.id, d.display_name, d.sort_order, d.status, d.parent_id, p.display_name AS parent_name
                        FROM default_dictionary_item d
                        LEFT JOIN default_dictionary_item p
                          ON p.dictionary_type = d.dictionary_type AND p.id = d.parent_id
                        WHERE d.dictionary_type = :type AND d.id = :id
                        """ + (forUpdate ? " FOR UPDATE OF d" : ""))
                .param("type", type.name()).param("id", id)
                .query(DefaultDictionaryRepository::mapRow).optional();
    }

    int maxSortOrder(DefaultDictionaryType type, UUID parentId) {
        return jdbc.sql("""
                        SELECT COALESCE(max(sort_order), -10) FROM default_dictionary_item
                        WHERE dictionary_type = :type AND parent_id IS NOT DISTINCT FROM :parentId
                        """)
                .param("type", type.name()).param("parentId", parentId)
                .query(Integer.class).single();
    }

    void insert(DefaultDictionaryType type, UUID id, String stableKey, String displayName,
                String normalizedName, int sortOrder, UUID parentId, Instant now) {
        jdbc.sql("""
                        INSERT INTO default_dictionary_item(
                            id, dictionary_type, stable_key, parent_id, display_name, normalized_name,
                            sort_order, status, created_at, updated_at)
                        VALUES (:id, :type, :stableKey, :parentId, :displayName, :normalizedName,
                                :sortOrder, 'ACTIVE', :now, :now)
                        """)
                .param("id", id).param("type", type.name()).param("stableKey", stableKey)
                .param("parentId", parentId).param("displayName", displayName)
                .param("normalizedName", normalizedName).param("sortOrder", sortOrder)
                .param("now", Timestamp.from(now)).update();
    }

    int updateStatus(DefaultDictionaryType type, UUID id, DefaultDictionaryStatus status, Instant now) {
        return jdbc.sql("""
                        UPDATE default_dictionary_item SET status = :status, updated_at = :now
                        WHERE dictionary_type = :type AND id = :id
                        """)
                .param("status", status.name()).param("now", Timestamp.from(now))
                .param("type", type.name()).param("id", id).update();
    }

    long activeChildren(UUID parentId) {
        return jdbc.sql("""
                        SELECT count(*) FROM default_dictionary_item
                        WHERE dictionary_type = 'EXPENSE_CATEGORY' AND parent_id = :id AND status = 'ACTIVE'
                        """).param("id", parentId).query(Long.class).single();
    }

    List<UUID> lockSiblingIds(DefaultDictionaryType type, UUID parentId) {
        return jdbc.sql("""
                        SELECT id FROM default_dictionary_item
                        WHERE dictionary_type = :type AND parent_id IS NOT DISTINCT FROM :parentId
                        ORDER BY sort_order, created_at, id FOR UPDATE
                        """)
                .param("type", type.name()).param("parentId", parentId).query(UUID.class).list();
    }

    void updateSortOrder(DefaultDictionaryType type, UUID id, int sortOrder, Instant now) {
        int affected = jdbc.sql("""
                        UPDATE default_dictionary_item SET sort_order = :sortOrder, updated_at = :now
                        WHERE dictionary_type = :type AND id = :id
                        """)
                .param("sortOrder", sortOrder).param("now", Timestamp.from(now))
                .param("type", type.name()).param("id", id).update();
        if (affected != 1) throw new IllegalStateException("默认字典排序写入未命中唯一记录");
    }

    private static DefaultRow mapRow(ResultSet rs, int rowNumber) throws SQLException {
        return new DefaultRow(rs.getObject("id", UUID.class), rs.getString("display_name"),
                rs.getInt("sort_order"), DefaultDictionaryStatus.valueOf(rs.getString("status")),
                rs.getObject("parent_id", UUID.class), rs.getString("parent_name"));
    }

    record DefaultRow(UUID id, String displayName, int sortOrder, DefaultDictionaryStatus status,
                      UUID parentId, String parentName) { }
    record CountRow(DefaultDictionaryType type, long total, long active) { }
}
