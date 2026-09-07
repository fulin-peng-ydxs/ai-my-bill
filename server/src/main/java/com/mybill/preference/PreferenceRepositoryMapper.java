package com.mybill.preference;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** PreferenceRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface PreferenceRepositoryMapper {
    List<Map<String, Object>> find(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> isActiveFundingChannel(@Param("p") Map<String, Object> parameters);

    int upsert(@Param("p") Map<String, Object> parameters);

    int delete(@Param("p") Map<String, Object> parameters);
}
