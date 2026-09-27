package com.mybill.account;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface AccountDeletionRepositoryMapper {
    List<Map<String, Object>> lockUser(@Param("p") Map<String, Object> params);
    List<Map<String, Object>> exportLocations(@Param("p") Map<String, Object> params);
    List<Map<String, Object>> exportLocationExists(@Param("p") Map<String, Object> params);
    int insertDeletionJob(@Param("p") Map<String, Object> params);
    int insertAudit(@Param("p") Map<String, Object> params);
    int deleteAdjustments(@Param("p") Map<String, Object> params);
    int deleteTemplates(@Param("p") Map<String, Object> params);
    int deleteLedger(@Param("p") Map<String, Object> params);
    int deleteProductMergeEvents(@Param("p") Map<String, Object> params);
    int deleteProducts(@Param("p") Map<String, Object> params);
    int deletePreferences(@Param("p") Map<String, Object> params);
    int deleteIdempotency(@Param("p") Map<String, Object> params);
    int deleteExports(@Param("p") Map<String, Object> params);
    int deleteExpenseCategories(@Param("p") Map<String, Object> params);
    int deleteUnits(@Param("p") Map<String, Object> params);
    int deleteFundingChannels(@Param("p") Map<String, Object> params);
    int deletePurchaseChannels(@Param("p") Map<String, Object> params);
    int deleteLocationLabels(@Param("p") Map<String, Object> params);
    int deleteIncomeCategories(@Param("p") Map<String, Object> params);
    int deletePayers(@Param("p") Map<String, Object> params);
    int deleteDeletionJobs(@Param("p") Map<String, Object> params);
    int deleteJobRuns(@Param("p") Map<String, Object> params);
    int deleteSessions(@Param("p") Map<String, Object> params);
    int anonymizePriorAdminAudits(@Param("p") Map<String, Object> params);
    int deleteUser(@Param("p") Map<String, Object> params);
    int deleteTenant(@Param("p") Map<String, Object> params);
    int purgeExpiredAudits(@Param("p") Map<String, Object> params);
}
