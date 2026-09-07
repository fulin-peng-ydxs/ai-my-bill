package com.mybill.shared.persistence;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** TenantDatabaseExecutor 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface TenantDatabaseExecutorMapper {
    List<Map<String, Object>> setTenantContext(@Param("p") Map<String, Object> parameters);
}
