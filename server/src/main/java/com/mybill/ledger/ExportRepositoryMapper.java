package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** ExportRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface ExportRepositoryMapper {
    int create(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findOwned(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findForJob(@Param("p") Map<String, Object> parameters);

    int markRunning(@Param("p") Map<String, Object> parameters);

    int markSucceeded(@Param("p") Map<String, Object> parameters);

    int markFailed(@Param("p") Map<String, Object> parameters);

    int markCancelled(@Param("p") Map<String, Object> parameters);

    int markExpired(@Param("p") Map<String, Object> parameters);
}
