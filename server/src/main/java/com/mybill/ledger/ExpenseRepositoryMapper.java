package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** ExpenseRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface ExpenseRepositoryMapper {
    int insertExpense(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findExpense(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockExpense(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> effectiveAdjustmentTotal(@Param("p") Map<String, Object> parameters);

    int updateExpense(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> deleteUndoableExpense(@Param("p") Map<String, Object> parameters);

    int deleteExpense(@Param("p") Map<String, Object> parameters);
}
