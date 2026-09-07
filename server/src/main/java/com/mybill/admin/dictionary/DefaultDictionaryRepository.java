package com.mybill.admin.dictionary;

import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import com.mybill.shared.persistence.DatabaseRow;
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
    private final MybatisOperations operations;
    private final DefaultDictionaryRepositoryMapper mapper;

    DefaultDictionaryRepository(MybatisOperations operations, DefaultDictionaryRepositoryMapper mapper) {
        this.operations = operations; this.mapper = mapper;
    }

    void lockCatalog() {
        operations.select(mapper::lockCatalog).param("lockId", CATALOG_LOCK)
                .map((rs, row) -> true).single();
    }

    List<CountRow> countAll() {
        return Arrays.stream(DefaultDictionaryType.values()).map(type -> operations.select(mapper::countAll).param("type", type.name())
                .map((rs, row) -> new CountRow(type, rs.getLong("total_count"), rs.getLong("active_count"))).single()).toList();
    }

    List<DefaultRow> list(DefaultDictionaryType type, String query, DefaultDictionaryStatus status,
                          int limit, int offset) {
        return operations.select(mapper::list)
                .param("type", type.name()).param("query", query)
                .param("status", status == null ? null : status.name())
                .param("limit", limit).param("offset", offset)
                .map(DefaultDictionaryRepository::mapRow).list();
    }

    long count(DefaultDictionaryType type, String query, DefaultDictionaryStatus status) {
        return operations.select(mapper::count)
                .param("type", type.name()).param("query", query)
                .param("status", status == null ? null : status.name())
                .map(Long.class).single();
    }

    Optional<DefaultRow> find(DefaultDictionaryType type, UUID id, boolean forUpdate) {
        return operations.select(mapper::find)
                .param("type", type.name()).param("id", id).param("forUpdate", forUpdate)
                .map(DefaultDictionaryRepository::mapRow).optional();
    }

    int maxSortOrder(DefaultDictionaryType type, UUID parentId) {
        return operations.select(mapper::maxSortOrder)
                .param("type", type.name()).param("parentId", parentId)
                .map(Integer.class).single();
    }

    void insert(DefaultDictionaryType type, UUID id, String stableKey, String displayName,
                String normalizedName, int sortOrder, UUID parentId, Instant now) {
        operations.update(mapper::insert)
                .param("id", id).param("type", type.name()).param("stableKey", stableKey)
                .param("parentId", parentId).param("displayName", displayName)
                .param("normalizedName", normalizedName).param("sortOrder", sortOrder)
                .param("now", Timestamp.from(now)).execute();
    }

    int updateStatus(DefaultDictionaryType type, UUID id, DefaultDictionaryStatus status, Instant now) {
        return operations.update(mapper::updateStatus)
                .param("status", status.name()).param("now", Timestamp.from(now))
                .param("type", type.name()).param("id", id).execute();
    }

    long activeChildren(UUID parentId) {
        return operations.select(mapper::activeChildren).param("id", parentId).map(Long.class).single();
    }

    List<UUID> lockSiblingIds(DefaultDictionaryType type, UUID parentId) {
        return operations.select(mapper::lockSiblingIds)
                .param("type", type.name()).param("parentId", parentId).map(UUID.class).list();
    }

    void updateSortOrder(DefaultDictionaryType type, UUID id, int sortOrder, Instant now) {
        int affected = operations.update(mapper::updateSortOrder)
                .param("sortOrder", sortOrder).param("now", Timestamp.from(now))
                .param("type", type.name()).param("id", id).execute();
        if (affected != 1) throw new IllegalStateException("默认字典排序写入未命中唯一记录");
    }

    private static DefaultRow mapRow(DatabaseRow rs, int rowNumber) throws SQLException {
        return new DefaultRow(rs.getObject("id", UUID.class), rs.getString("display_name"),
                rs.getInt("sort_order"), DefaultDictionaryStatus.valueOf(rs.getString("status")),
                rs.getObject("parent_id", UUID.class), rs.getString("parent_name"));
    }

    record DefaultRow(UUID id, String displayName, int sortOrder, DefaultDictionaryStatus status,
                      UUID parentId, String parentName) { }
    record CountRow(DefaultDictionaryType type, long total, long active) { }
}
