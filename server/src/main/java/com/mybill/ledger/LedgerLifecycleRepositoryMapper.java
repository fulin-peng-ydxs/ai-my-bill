package com.mybill.ledger;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/** LedgerLifecycleRepository 对应的 MyBatis Mapper；SQL 统一维护在同名 XML。 */
@Mapper
public interface LedgerLifecycleRepositoryMapper {
    List<Map<String, Object>> findLedger(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> findAdjustment(@Param("p") Map<String, Object> parameters);

    int trashLedger(@Param("p") Map<String, Object> parameters);

    int restoreLedger(@Param("p") Map<String, Object> parameters);

    int trashAdjustment(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> restoreAdjustment(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> effectiveAdjustmentTotal(@Param("p") Map<String, Object> parameters);

    int reactivateAdjustment(@Param("p") Map<String, Object> parameters);

    List<Map<String, Object>> purgeLedger(@Param("p") Map<String, Object> parameters);

    int deleteLedgerAdjustments(@Param("p") Map<String, Object> parameters);

    int deleteLedger(@Param("p") Map<String, Object> parameters);

    int purgeAdjustment(@Param("p") Map<String, Object> parameters);
}
