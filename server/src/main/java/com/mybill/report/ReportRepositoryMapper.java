package com.mybill.report;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 报表只读聚合 Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface ReportRepositoryMapper {
    List<Map<String, Object>> summary(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> timeBuckets(@Param("p") Map<String, Object> parameters);
    List<Map<String, Object>> accountCreatedDate(@Param("p") Map<String, Object> parameters);
}
