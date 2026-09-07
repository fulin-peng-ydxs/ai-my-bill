package com.mybill.job;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** 后台任务仓储的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface JobRunRepositoryMapper {
    int schedule(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findScheduledId(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> find(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> claimNext(@Param("p") Map<String, Object> parameters);

    int renew(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> isCancellationRequested(@Param("p") Map<String, Object> parameters);

    int releaseForMore(@Param("p") Map<String, Object> parameters);

    int failOrRetry(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findExpired(@Param("p") Map<String, Object> parameters);

    int recoverExpired(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> requestCancellation(@Param("p") Map<String, Object> parameters);

    int cancelPending(@Param("p") Map<String, Object> parameters);

    int requestRunningCancellation(@Param("p") Map<String, Object> parameters);

    int terminal(@Param("p") Map<String, Object> parameters);
}
