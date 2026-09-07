package com.mybill.dictionary;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 个人字典持久化 Mapper；动态表选择仅允许 XML 中的固定枚举分支。 */
@Mapper
public interface PersonalDictionaryRepositoryMapper {
    List<Map<String, Object>> list(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> count(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> countAll(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> find(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> maxSortOrder(@Param("p") Map<String, Object> parameters);
    int insert(@Param("p") Map<String, Object> parameters);
    int rename(@Param("p") Map<String, Object> parameters);
    int updateStatus(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> activeChildren(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> lockSiblingIds(@Param("p") Map<String, Object> parameters);
    int updateSortOrder(@Param("p") Map<String, Object> parameters);
}
