package com.mybill.auth;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.time.Instant;
import java.util.UUID;

/** 仅供一次性首管理员初始化使用；SQL 保持在 XML，且不接触租户账目。 */
@Mapper
public interface InitialAdminMapper {
    void lockAccounts();
    long countAccounts();
    int insert(@Param("id") UUID id, @Param("username") String username,
               @Param("digest") String digest, @Param("expiresAt") Instant expiresAt);
    int audit(@Param("id") UUID id, @Param("adminId") UUID adminId);
}
