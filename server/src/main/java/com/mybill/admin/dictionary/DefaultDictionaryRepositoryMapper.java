package com.mybill.admin.dictionary;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** DefaultDictionaryRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface DefaultDictionaryRepositoryMapper {
    List<Map<String, Object>> lockCatalog(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> countAll(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> find(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> list(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> count(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> maxSortOrder(@Param("p") Map<String, Object> parameters);

    int insert(@Param("p") Map<String, Object> parameters);

    int updateStatus(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> activeChildren(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockSiblingIds(@Param("p") Map<String, Object> parameters);

    int updateSortOrder(@Param("p") Map<String, Object> parameters);
}
