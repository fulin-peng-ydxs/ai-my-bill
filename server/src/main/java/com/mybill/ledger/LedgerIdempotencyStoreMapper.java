package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** LedgerIdempotencyStore 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface LedgerIdempotencyStoreMapper {
    int reserve(@Param("p") Map<String, Object> parameters);

    int insertReservation(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockReservation(@Param("p") Map<String, Object> parameters);

    int complete(@Param("p") Map<String, Object> parameters);

    int deleteResult(@Param("p") Map<String, Object> parameters);
}
