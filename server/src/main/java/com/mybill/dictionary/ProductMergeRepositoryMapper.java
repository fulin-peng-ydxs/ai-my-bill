package com.mybill.dictionary;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** ProductMergeRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface ProductMergeRepositoryMapper {
    List<Map<String, Object>> findProduct(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockProducts(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> countLedgerEntries(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findTemplate(@Param("p") Map<String, Object> parameters);

    int updateLedgerProduct(@Param("p") Map<String, Object> parameters);

    int moveTemplate(@Param("p") Map<String, Object> parameters);

    int copyTemplatePayload(@Param("p") Map<String, Object> parameters);

    int deleteTemplate(@Param("p") Map<String, Object> parameters);

    int repointPreviousMerges(@Param("p") Map<String, Object> parameters);

    int markMerged(@Param("p") Map<String, Object> parameters);

    int insertEvent(@Param("p") Map<String, Object> parameters);

    int renameTemplate(@Param("p") Map<String, Object> parameters);
}
