package com.mybill.admin.audit;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 管理审计仓储的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface AdminAuditRepositoryMapper {
    int append(@Param("p") Map<String, Object> parameters);
}
