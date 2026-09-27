package com.mybill.admin.overview;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 运行概况只查询账号元数据和数据库容量，SQL 统一位于 Mapper XML。 */
@Mapper
public interface AdminOverviewRepositoryMapper {
    List<Map<String, Object>> overview(@Param("p") Map<String, Object> parameters);
}
