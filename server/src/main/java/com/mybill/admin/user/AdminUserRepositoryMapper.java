package com.mybill.admin.user;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** AdminUserRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface AdminUserRepositoryMapper {
    List<Map<String, Object>> findUsers(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> countUsers(@Param("p") Map<String, Object> parameters);

    int createTenant(@Param("p") Map<String, Object> parameters);

    int createUser(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> copyDefaultDictionaries(@Param("p") Map<String, Object> parameters);

    int copyExpenseCategories(@Param("p") Map<String, Object> parameters);

    int copySimple(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findUserForUpdate(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findUser(@Param("p") Map<String, Object> parameters);

    int updateStatus(@Param("p") Map<String, Object> parameters);

    int updateTenantStatus(@Param("p") Map<String, Object> parameters);

    int resetTemporaryPassword(@Param("p") Map<String, Object> parameters);
}
