package com.mybill.account;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 离线维护专用查询，不通过 HTTP 暴露；所有生产 SQL 仍位于 XML。 */
@Mapper
interface RecoveryAuditMapper {
    String fingerprint();
    String databaseName();
    List<String> exportPage(@Param("after") UUID after, @Param("now") Instant now);
    int importAudit(@Param("json") String json);
    String auditDigest(@Param("id") UUID id);
    List<UUID> restoredUsers(@Param("digest") String digest);
}
