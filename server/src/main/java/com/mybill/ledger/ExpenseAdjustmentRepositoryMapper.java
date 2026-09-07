package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** ExpenseAdjustmentRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface ExpenseAdjustmentRepositoryMapper {
    List<Map<String, Object>> lockActiveExpense(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> effectiveTotal(@Param("p") Map<String, Object> parameters);

    int insert(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> find(@Param("p") Map<String, Object> parameters);

    int revoke(@Param("p") Map<String, Object> parameters);
}
