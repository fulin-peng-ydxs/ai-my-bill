package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** DailyTemplateRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface DailyTemplateRepositoryMapper {
    List<Map<String, Object>> lockActiveSource(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> upsert(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> list(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockTemplate(@Param("p") Map<String, Object> parameters);

    int touch(@Param("p") Map<String, Object> parameters);

    int delete(@Param("p") Map<String, Object> parameters);
}
