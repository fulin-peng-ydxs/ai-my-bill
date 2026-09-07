package com.mybill.persistence.config;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 生产 schema 版本门禁查询。 */
@Mapper
public interface SchemaVersionGuardMapper {
    List<Map<String, Object>> latestVersion(@Param("p") Map<String, Object> parameters);
}
