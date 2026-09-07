package com.mybill.auth;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** AuthRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface AuthRepositoryMapper {
    List<Map<String, Object>> findUserByUsername(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findUserById(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findSession(@Param("p") Map<String, Object> parameters);

    int createSession(@Param("p") Map<String, Object> parameters);

    int touchSession(@Param("p") Map<String, Object> parameters);

    int touchUserActivity(@Param("p") Map<String, Object> parameters);

    int revokeSession(@Param("p") Map<String, Object> parameters);

    int revokeAllSessions(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> replacePassword(@Param("p") Map<String, Object> parameters);

    int ensureRateLimitRow(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> hasActiveLoginLock(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockRateLimit(@Param("p") Map<String, Object> parameters);

    int recordFailure(@Param("p") Map<String, Object> parameters);

    int clearLoginFailures(@Param("p") Map<String, Object> parameters);
}
