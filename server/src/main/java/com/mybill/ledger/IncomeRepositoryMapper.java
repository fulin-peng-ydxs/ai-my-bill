package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** IncomeRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface IncomeRepositoryMapper {
    int insert(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> find(@Param("p") Map<String, Object> parameters);

    int update(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> names(@Param("p") Map<String, Object> parameters);

    int deleteUndoable(@Param("p") Map<String, Object> parameters);
}
