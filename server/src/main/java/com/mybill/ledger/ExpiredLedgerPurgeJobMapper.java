package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** ExpiredLedgerPurgeJob 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface ExpiredLedgerPurgeJobMapper {
    List<Map<String, Object>> executeBatch(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockExpiredLedgers(@Param("p") Map<String, Object> parameters);

    int deleteLinkedAdjustments(@Param("p") Map<String, Object> parameters);

    int deleteLedgers(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> lockExpiredAdjustments(@Param("p") Map<String, Object> parameters);

    int deleteAdjustments(@Param("p") Map<String, Object> parameters);
}
