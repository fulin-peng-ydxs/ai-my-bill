package com.mybill.dictionary;

import com.mybill.shared.persistence.DatabaseRow;
import com.mybill.shared.persistence.MybatisOperations;
import org.springframework.stereotype.Repository;

import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 在已设置 RLS 上下文的事务内访问枚举白名单中的个人字典表。 */
@Repository
class PersonalDictionaryRepository {
    private final MybatisOperations operations;
    private final PersonalDictionaryRepositoryMapper mapper;

    PersonalDictionaryRepository(MybatisOperations operations, PersonalDictionaryRepositoryMapper mapper) {
        this.operations = operations;
        this.mapper = mapper;
    }

    List<DictionaryRow> list(DictionaryType type, String query, DictionaryStatus status, int limit, int offset,
                             boolean candidatesOnly, UUID parentId, boolean rootsOnly) {
        return operations.select(mapper::list).param("type", type.name()).param("query", query)
                .param("status", status == null ? null : status.name()).param("limit", limit).param("offset", offset)
                .param("candidatesOnly", candidatesOnly).param("parentId", parentId).param("rootsOnly", rootsOnly).map(PersonalDictionaryRepository::mapRow).list();
    }

    long count(DictionaryType type, String query, DictionaryStatus status, boolean candidatesOnly, UUID parentId, boolean rootsOnly) {
        return operations.select(mapper::count).param("type", type.name()).param("query", query)
                .param("status", status == null ? null : status.name()).param("candidatesOnly", candidatesOnly).param("parentId", parentId).param("rootsOnly", rootsOnly)
                .map(Long.class).single();
    }

    List<CountRow> countAll() {
        return Arrays.stream(DictionaryType.values()).map(type -> operations.select(mapper::countAll)
                .param("type", type.name()).map((row, index) -> new CountRow(type,
                        row.getLong("total_count"), row.getLong("active_count"))).single()).toList();
    }

    Optional<DictionaryRow> findForUpdate(DictionaryType type, UUID id) { return find(type, id, true); }
    Optional<DictionaryRow> find(DictionaryType type, UUID id) { return find(type, id, false); }

    private Optional<DictionaryRow> find(DictionaryType type, UUID id, boolean forUpdate) {
        return operations.select(mapper::find).param("type", type.name()).param("id", id)
                .param("forUpdate", forUpdate).map(PersonalDictionaryRepository::mapRow).optional();
    }

    int maxSortOrder(DictionaryType type, UUID parentId) {
        return operations.select(mapper::maxSortOrder).param("type", type.name()).param("parentId", parentId)
                .map(Integer.class).single();
    }

    void insert(DictionaryType type, UUID id, String displayName, String normalizedName,
                int sortOrder, UUID parentId, Instant now) {
        operations.update(mapper::insert).param("type", type.name()).param("id", id).param("name", displayName)
                .param("normalized", normalizedName).param("sortOrder", sortOrder).param("parentId", parentId)
                .param("now", Timestamp.from(now)).execute();
    }

    int rename(DictionaryType type, UUID id, String displayName, String normalizedName, Instant now) {
        return operations.update(mapper::rename).param("type", type.name()).param("name", displayName)
                .param("normalized", normalizedName).param("now", Timestamp.from(now)).param("id", id).execute();
    }

    int updateStatus(DictionaryType type, UUID id, DictionaryStatus status, Instant now) {
        return operations.update(mapper::updateStatus).param("type", type.name()).param("status", status.name())
                .param("now", Timestamp.from(now)).param("id", id).execute();
    }

    long activeChildren(UUID parentId) {
        return operations.select(mapper::activeChildren).param("id", parentId).map(Long.class).single();
    }

    List<UUID> lockSiblingIds(DictionaryType type, UUID parentId) {
        return operations.select(mapper::lockSiblingIds).param("type", type.name()).param("parentId", parentId)
                .map(UUID.class).list();
    }

    void updateSortOrder(DictionaryType type, UUID id, int sortOrder, Instant now) {
        int affected = operations.update(mapper::updateSortOrder).param("type", type.name())
                .param("sortOrder", sortOrder).param("now", Timestamp.from(now)).param("id", id).execute();
        if (affected != 1) throw new IllegalStateException("字典排序写入未命中唯一记录");
    }

    private static DictionaryRow mapRow(DatabaseRow row, int rowNumber) throws SQLException {
        return new DictionaryRow(row.getObject("id", UUID.class), row.getString("display_name"),
                row.getInt("sort_order"), DictionaryStatus.valueOf(row.getString("status")),
                row.getObject("parent_id", UUID.class), row.getString("parent_name"), row.getBoolean("referenced"));
    }

    record DictionaryRow(UUID id, String displayName, int sortOrder, DictionaryStatus status,
                         UUID parentId, String parentName, boolean referenced) { }
    record CountRow(DictionaryType type, long total, long active) { }
}
